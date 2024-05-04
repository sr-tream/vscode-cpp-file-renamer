import * as vscode from 'vscode';
import { IParser, getParser } from "./parser";
import { compile_commands } from "./compile_commands";
import { CodeModel } from "./code_model";
import { Config } from './config';
import * as path from 'path';
import { SyntaxNode, Tree, Point } from 'web-tree-sitter';

// TODO: cache

class CppRenamer implements vscode.Disposable {
	private parser: IParser;
	private renameWatcher: vscode.Disposable = {
		dispose: () => { }
	};
	private codeModel: CodeModel.CodeModel = new CodeModel.CodeModel();
	private compileCommands: compile_commands | undefined;
	// TODO: CMake support

	constructor(parser: IParser) {
		this.parser = parser;
		this.renameWatcher = vscode.workspace.onDidRenameFiles(this.didRenameFiles.bind(this))

		this.doInitialize();
	}

	public dispose() {
		this.compileCommands?.dispose();
		this.renameWatcher.dispose();
	}

	// FIXME: It can skip `initializeCompileCommands` awaiting and return true with partial initialization
	private async doInitialize(): Promise<boolean> {
		return new Promise((resolve) => {
			if (this.isInitialized()) return resolve(true);

			this.initializeCompileCommands().then(() => {
				resolve(this.isInitialized());
			});
		});
	}

	private isInitialized(): boolean {
		return (this.compileCommands !== undefined && this.compileCommands.isInitialized()) || /* CHECK IS CMAKE NOT INITIALIZED */ false;
	}

	private async initializeCompileCommands() {
		if (this.compileCommands === undefined) {
			this.compileCommands = new compile_commands(this.codeModel);
		}
		try {
			await this.compileCommands?.setPath(compile_commands.findCompileCommands());
		} catch (error) {
			const config = Config.read();
			if (config.compileCommands.debug)
				vscode.window.showErrorMessage(`Failed to find compile_commands.json: ${error}`);
		}
	}

	private async didRenameFiles(event: vscode.FileRenameEvent): Promise<void> {
		this.doInitialize().then((initialized) => {
			if (!initialized) return;

			// BUG: May be not initialized here
			let includeCaches: Map<string, CodeModel.Include[]> = new Map();
			event.files.forEach((file) => {
				const oldFilepath = file.oldUri.fsPath;
				const newFilepath = file.newUri.fsPath;
				// Rename file in local codebase
				this.codeModel.renameFile(oldFilepath, newFilepath);

				// TODO: Rename correspond header file
				if (CodeModel.isSourceFile(oldFilepath)) return;

				if (path.dirname(oldFilepath) != path.dirname(newFilepath))
					return; // TODO: Implement move files

				this.codeModel.forEach(async (filename, includePaths, cache) => {
					const uri = vscode.Uri.parse(filename);
					let document = vscode.workspace.textDocuments.find(
						(textDocument) => textDocument.uri.toString() === uri.toString()
					);
					const needClose = document === undefined;
					if (needClose) {
						document = await vscode.workspace.openTextDocument(uri);
						await vscode.window.showTextDocument(document);
					}
					const dirty = document && document.isDirty;

					try {
						let newCache: CodeModel.Include[] = [];
						if (cache.length === 0) {
							const tree = this.parser.getTreeForUri(uri);
							this.ForEachIncludeInNode(tree.rootNode, async (include, range) => {
								this.doRenameInclude(uri, file, include, range, includePaths).then(cachedInclude => {
									newCache.push(cachedInclude);
								});
							}).then(() => {
								includeCaches.set(filename, newCache);
							});
						} else {
							cache.forEach(async (cached) => {
								this.doRenameInclude(uri, file, cached.include, cached.range, includePaths).then(cachedInclude => {
									newCache.push(cachedInclude);
								});
							});
							includeCaches.set(filename, newCache);
						}
					} catch (e) {
						vscode.window.showErrorMessage("Failed edit file " + filename);
					}

					const config = Config.read();
					if (config.experimental.renameSourceFile) {
						// TODO: Find correspond file in different folders
						const srcExt = path.extname(filename);
						const srcPathNoExt = filename.slice(0, -1 * srcExt.length);
						const hdrPathNoExt = oldFilepath.slice(0, -1 * path.extname(oldFilepath).length);
						if (srcPathNoExt == hdrPathNoExt) {
							const newHdrPathNoExt = newFilepath.slice(0, -1 * path.extname(newFilepath).length);
							const newUri = vscode.Uri.parse(newHdrPathNoExt + srcExt);
							let edit = new vscode.WorkspaceEdit();
							edit.renameFile(vscode.Uri.parse(filename), newUri);
							await vscode.workspace.applyEdit(edit);
							document = vscode.workspace.textDocuments.find(
								(textDocument) => textDocument.uri.toString() === newUri.toString()
							);

							// TODO: For CMake with FILE GLOBs or AUS_SOURCE_DIRECTORY we can trigger configure
						}
					}

					if (!dirty) await document?.save();

					if (needClose) {
						vscode.commands.executeCommand('workbench.action.closeActiveEditor');
					}
				});
			});

			includeCaches.forEach(async (includes, filename) => {
				this.codeModel.setFileCache(filename, includes);
			});
		});
	}

	private async doRenameInclude(uri: vscode.Uri,
		file: {
			readonly oldUri: vscode.Uri;
			readonly newUri: vscode.Uri;
		},
		include: string,
		range: vscode.Range,
		includePaths: string[]): Promise<CodeModel.Include> {

		const IncFilename = path.basename(include);
		let cachedInclude = {
			include: include,
			range: range
		};

		const oldFilepath = file.oldUri.fsPath;
		const oldFilename = path.basename(oldFilepath);
		if (oldFilename !== IncFilename) {
			return cachedInclude;
		}

		const startOffset = include.indexOf(IncFilename);
		if (startOffset > 0) {
			const start = new vscode.Position(range.start.line, range.start.character + startOffset);
			range = new vscode.Range(start, range.end);
		}

		const fileDir = path.dirname(uri.fsPath);
		const dirs = [fileDir, ...includePaths];
		for (const dir of dirs) {
			const absolutePath = path.normalize(dir + '/' + include);
			if (oldFilepath !== absolutePath) continue;

			const newFilename = path.basename(file.newUri.fsPath);

			let edit = new vscode.WorkspaceEdit();
			edit.replace(uri, range, newFilename);
			await vscode.workspace.applyEdit(edit);

			const end = new vscode.Position(range.end.line, range.start.character + newFilename.length);
			cachedInclude.range = new vscode.Range(cachedInclude.range.start, end);
			break;
		}

		return cachedInclude;
	}

	private async ForEachIncludeInNode(node: SyntaxNode, callback: (include: string, range: vscode.Range) => void): Promise<void> {
		if (node.type === 'preproc_include') {
			for (let i = 0; i < node.childCount; i++) {
				const child = node.child(i);
				if (child === null || child.isError()) continue;

				const system_lib_string = child.type === 'system_lib_string';
				const string_literal = child.type === 'string_literal';
				if ((system_lib_string || string_literal) && child.text.length > 2) {
					const start = new vscode.Position(child.startPosition.row, child.startPosition.column + 1);
					const end = new vscode.Position(child.endPosition.row, child.endPosition.column - 1);
					callback(child.text.slice(1, -1), new vscode.Range(start, end));
					break;
				}
			}
			return;
		}
		for (let i = 0; i < node.childCount; i++) {
			const child = node.child(i);
			if (child !== null && !child.isError())
				this.ForEachIncludeInNode(child, callback);
		}
	}

	// TODO: use progressbar on rename
}

export function activate(context: vscode.ExtensionContext) {
	getParser().then((parser) => {
		context.subscriptions.push(new CppRenamer(parser));
	}).catch(e => {
		vscode.window.showErrorMessage(`${e}`);
	});

	// TODO: Command to reload CppRenamer
	let disposable = vscode.commands.registerCommand('vscode-cpp-file-renamer.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from vscode-cpp-file-renamer!');
	});

	context.subscriptions.push(disposable);
}

export function deactivate() { }
