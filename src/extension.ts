import * as vscode from "vscode";
import { WorkTreeProvider } from "./views/workTreeProvider";
import { GlossaryTreeProvider } from "./views/glossaryTreeProvider";

export function activate(context: vscode.ExtensionContext) {
  const workTreeProvider = new WorkTreeProvider();
  const glossaryTreeProvider = new GlossaryTreeProvider();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("novelTranslate.works", workTreeProvider),
    vscode.window.registerTreeDataProvider("novelTranslate.glossary", glossaryTreeProvider),
    vscode.commands.registerCommand("novelTranslate.createWork", () => {
      vscode.window.showInformationMessage("作品管理功能將於後續版本推出。");
    }),
    vscode.commands.registerCommand("novelTranslate.openCompareView", () => {
      vscode.window.showInformationMessage("原文／譯文比對功能將於後續版本推出。");
    })
  );
}

export function deactivate() {}
