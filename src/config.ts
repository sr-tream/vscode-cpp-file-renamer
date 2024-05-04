import * as vscode from 'vscode';

export namespace Config {
    export interface CompileCommands {
        path: string;
        debug: boolean;
    }
    export const DEFAULT_COMPILE_COMMANDS: CompileCommands = {
        path: "",
        debug: false
    }

    export interface Experimental {
        renameSourceFile: boolean
    }
    export const DEFAULT_EXPERIMENTAL: Experimental = {
        renameSourceFile: false
    }

    export interface Global {
        compileCommands: CompileCommands,
        experimental: Experimental
    }
    export const DEFAULT_GLOBAL: Global = {
        compileCommands: DEFAULT_COMPILE_COMMANDS,
        experimental: DEFAULT_EXPERIMENTAL
    }

    export function read(): Global {
        const config = vscode.workspace.getConfiguration();
        return config.get<Global>('vscode-cpp-file-renamer', DEFAULT_GLOBAL);
    }
}