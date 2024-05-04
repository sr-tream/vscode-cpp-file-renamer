import * as vscode from 'vscode';
import * as path from 'path';

// TODO: cache. It's must be updated on file change.

export namespace CodeModel {
    export interface Include {
        include: string;
        range: vscode.Range;
    }
    export interface File {
        includePaths: string[];
        cache: Include[]
    }
    export type Files = Map<string, File>;

    const SourceFiles = ['c', 'C', 'cc', 'CC', 'cl', 'clcpp', 'cp', 'cu', 'ccm', 'cpp', 'CPP', 'c++', 'C++', 'cxx', 'CXX', 'c++m', 'cppm', 'cxxm', 'hlsl', 'm', 'M', 'mm'];
    export function isSourceFile(fileName: string): boolean {
        return SourceFiles.indexOf(path.extname(fileName).slice(1)) >= 0;
    }

    export class CodeModel implements vscode.Disposable {
        private files: Files = new Map();
        private changeWatcher: vscode.Disposable = {
            dispose: () => { }
        };

        constructor() {
            this.changeWatcher = vscode.workspace.onDidChangeTextDocument(this.didChangeTextDocument, this);
        }

        public dispose() {
            this.changeWatcher.dispose();
        }

        public async getFiles(): Promise<Files> {
            return this.files;
        }

        public async getFile(filePath: string): Promise<File | undefined> {
            const file = this.files.get(filePath);
            if (file !== undefined || isSourceFile(filePath)) return file;

            // Try to find correspond file in same directory
            const fileExt = path.extname(filePath);
            const templ = filePath.slice(0, -1 * (fileExt.length - 1));
            for (const ext of SourceFiles) {
                const filePath = templ + ext;
                let file = this.files.get(filePath);
                if (file !== undefined) {
                    file.cache = []; // Drop caches, because we want to copy only include paths
                    return file;
                }
            }
            return undefined;
        }

        public async setFiles(files: Files): Promise<void> {
            this.files = files;
        }

        // TODO: Method to update files: compare keys and keep old values To prevent drop cache

        public async setFile(filePath: string, includePaths: string[]): Promise<void> {
            this.files.set(filePath, { includePaths, cache: [] });
        }

        public async renameFile(oldFilePath: string, newFilePath: string): Promise<void> {
            this.getFile(oldFilePath).then((model) => {
                if (model === undefined) return;

                this.files.delete(oldFilePath);
                this.files.set(newFilePath, model);
            });
        }

        public async setFileCache(filePath: string, cache: Include[]): Promise<void> {
            const old = this.files.get(filePath);
            if (!old) return;
            this.files.set(filePath, { includePaths: old.includePaths, cache: cache });
        }

        public async removeFile(filePath: string): Promise<void> {
            this.files.delete(filePath);
        }

        public async clearFiles(): Promise<void> {
            this.files.clear();
        }

        public async forEach(callback: (file: string, includePaths: string[], cache: Include[]) => void): Promise<void> {
            this.files.forEach(({ includePaths, cache }, file) => callback(file, includePaths, cache));
        }

        private async didChangeTextDocument(e: vscode.TextDocumentChangeEvent): Promise<void> {
            const file = e.document.uri.fsPath;

            // Drop includes cache on file change
            if (this.files.has(file))
                this.files.get(file)!.cache = [];
        }
    }
}