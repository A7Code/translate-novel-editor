import * as vscode from "vscode";
import { CompareView } from "./compareView";
import { getPunctuationSuggestTriggerText } from "./extensions/punctuationSuggestProvider";

// 快捷鍵進入點：在游標位置插入設定好的觸發文字，效果等同使用者自己手動打出
// 觸發文字，再強制跳出補完清單。這樣只需要維護 PunctuationSuggestCompletionProvider
// 裡的唯一一套判斷邏輯，不用在這裡重複一份「找原文同一行標點」的程式碼。
export async function suggestPunctuationFromOriginal(compareView: CompareView): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  if (compareView.sideOf(editor.document.uri) !== "translation") {
    vscode.window.showInformationMessage("請在比對畫面的「譯文」編輯器裡使用這個功能。");
    return;
  }

  const triggerText = getPunctuationSuggestTriggerText();
  const position = editor.selection.active;
  const inserted = await editor.edit((editBuilder) => editBuilder.insert(position, triggerText));
  if (!inserted) {
    return;
  }
  await vscode.commands.executeCommand("editor.action.triggerSuggest");
}
