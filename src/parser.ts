import * as vscode from 'vscode';
import * as Parser from "web-tree-sitter";

export interface IParser {
    loadLanguage(languageId: string): boolean,
    getLanguage(languageId: string): Parser.Language | undefined,
    registerLanguage(languageId: string, wasmPath: string): void,
    getTree(document: vscode.TextDocument): Parser.Tree,
    getTreeForUri(uri: vscode.Uri): Parser.Tree,
    getNodeAtLocation(location: vscode.Location): Parser.Tree
}

export async function getParser(): Promise<IParser> {
    const parseTreeExtension = vscode.extensions.getExtension<IParser>("pokey.parse-tree");

    if (parseTreeExtension == null) {
        throw new Error("Depends on pokey.parse-tree extension");
    }

    return parseTreeExtension.isActive ? parseTreeExtension.exports : parseTreeExtension.activate();
}