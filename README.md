# VSCode C++ Renamer

It's a crouch for [vscode-clangd](https://github.com/clangd/vscode-clangd) to automatically fix includes on rename header files.

Extension uses [Parse tree](https://github.com/cursorless-dev/vscode-parse-tree) and `compile_commands.json` to find includes in the project.

Limitations:
- `compile_commands.json` may not include header files - so includes don't fixed automatically for them (need scan full-project to resolve it);
- can rename correspond source file, but this action do not update you code model (e.g. CMakeLists.txt);
- use VSCode `WorkspaceEdit` to modify files - so require open file in editor to modify (extension do it automatically, and close file after editing);
- can't parallel reload `compile_commands.json` and rename includes (BUG - broken parser awaiting).

### TODO
- [ ] add support for CMake Tools;
- [ ] ~~parse all files in workspace to find includes~~ recursive extract and parse includes from source files;
- [ ] fix bug with parallel reload `compile_commands.json` and rename includes;
- [ ] use own instance of tree-sitter for background editing;
- [ ] rename correspond header file, when rename source file (and fix includes).