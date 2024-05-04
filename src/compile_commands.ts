import * as vscode from 'vscode';
import * as fs from 'fs';
import { Config } from './config';
import { CodeModel } from './code_model';

namespace types {
    export interface TU {
        directory?: string,
        command: string,
        file?: string,
        output?: string
    }

    export type compile_commands = TU[];
}

export class compile_commands implements vscode.Disposable {
    private codeModel: CodeModel.CodeModel;
    private watchedCompileCommands: string = '';
    private watcher: vscode.FileSystemWatcher | undefined;
    private onChange: vscode.Disposable = { dispose() { } };
    private onChangeDocument: vscode.Disposable = { dispose() { } };

    constructor(CodeModel: CodeModel.CodeModel) {
        this.codeModel = CodeModel;
        this.onChangeDocument = vscode.workspace.onDidChangeTextDocument(this.onDidChangeDocument.bind(this));
    }

    public dispose() {
        this.onChange.dispose();
        this.watcher?.dispose();
        this.onChangeDocument.dispose();
    }

    public async setPath(path: vscode.Uri): Promise<void> {
        if (path.fsPath === this.watchedCompileCommands)
            return;

        this.onChange.dispose();
        this.watcher?.dispose();

        this.watcher = vscode.workspace.createFileSystemWatcher(path.fsPath);
        this.onChange = this.watcher.onDidChange(this.onDidChange.bind(this));

        return new Promise((resolve) => {
            this.watchedCompileCommands = '';
            this.onDidChange(path).then(() => {
                this.watchedCompileCommands = path.fsPath;
                resolve();
            });
        });
    }

    public isInitialized(): boolean {
        return this.watchedCompileCommands.length > 0;
    }

    public static findCompileCommands(workspace?: vscode.Uri): vscode.Uri {
        const config = Config.read();
        if (fs.existsSync(config.compileCommands.path))
            return vscode.Uri.file(config.compileCommands.path);

        if (workspace === undefined) workspace = vscode.workspace.workspaceFolders?.[0].uri;
        if (workspace === undefined) throw new Error("No workspace folders");

        if (fs.existsSync(workspace.fsPath + "/compile_commands.json"))
            return vscode.Uri.file(workspace.fsPath + "/compile_commands.json");

        if (fs.existsSync(workspace.fsPath + "/build/compile_commands.json"))
            return vscode.Uri.file(workspace.fsPath + "/build/compile_commands.json");

        throw new Error("No compile_commands.json found");
    }

    private async onDidChangeDocument(event: vscode.TextDocumentChangeEvent) {
        const workspace = vscode.workspace.getWorkspaceFolder(event.document.uri)?.uri;
        try {
            const path = compile_commands.findCompileCommands(workspace);
            this.setPath(path);
        } catch (error) {
            const config = Config.read();
            if (config.compileCommands.debug)
                vscode.window.showErrorMessage(`Failed to find compile_commands.json: ${error}`);
        }
    }

    private async onDidChange(uri: vscode.Uri) {
        fs.promises.readFile(uri.fsPath, 'utf8').then(data => {
            const json = JSON.parse(data) as types.compile_commands;
            let codeModel: CodeModel.Files = new Map();
            for (const tu of json) {
                if (tu.file === undefined) continue;

                let includePats = [];
                let nextArgIsInclude = false;
                const args = this.parseQuotedString(tu.command);
                const incArgs = ['-I', '-iquote', '-isystem', '-include-pch', '-include', '/I', '/imsvc'];
                for (const arg of args) {
                    if (nextArgIsInclude) {
                        includePats.push(arg);
                        nextArgIsInclude = false;
                        continue;
                    }

                    for (const incArg of incArgs) {
                        if (arg === incArg) {
                            nextArgIsInclude = true;
                            break;
                        }
                        if (arg.startsWith(incArg + '=') || arg.startsWith(incArg + ':')) {
                            includePats.push(arg.slice(incArg.length + 1));
                            break;
                        }
                        else if (arg.startsWith(incArg)) {
                            includePats.push(arg.slice(incArg.length));
                            break;
                        }
                    }
                }
                // TODO: If file opened - get AST and create cache for it
                codeModel.set(tu.file, { includePaths: includePats, cache: [] });
            }
            this.codeModel.setFiles(codeModel);
        });
    }

    private parseQuotedString(input: string): string[] {
        const result: string[] = [];
        let currentToken = '';
        let inQuotes = false;
        let quoteToken = '';

        for (let i = 0; i < input.length; i++) {
            const char = input[i];

            if ((char === '"' || char === '\'') && (quoteToken === '' || quoteToken === char)) {
                inQuotes = !inQuotes;
                quoteToken = inQuotes ? char : '';
            } else if (char === ' ' && !inQuotes) {
                if (currentToken !== '') {
                    result.push(currentToken);
                    currentToken = '';
                }
            } else {
                currentToken += char;
            }
        }

        // Add the last token if it exists
        if (currentToken !== '') {
            result.push(currentToken);
        }

        return result;
    }
}