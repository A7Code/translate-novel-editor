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

// 讓使用者自訂這個功能的快捷鍵：VS Code 的按鍵綁定（package.json 的 "keybindings" 貢獻）
// 是編譯期寫死的設定，沒有任何擴充功能 API 可以在執行期改掉實際生效的按鍵組合，
// 所以不自己刻一套「按下任意鍵來綁定」的畫面（這類原始鍵盤攔截也不是擴充功能 API
// 能做到的事）。VS Code 內建的「鍵盤快速鍵」設定頁本來就支援使用者自行改／刪除
// 任何指令（包含擴充功能貢獻的指令）的按鍵，這裡只是直接開那個頁面、並用
// "@command:" 篩選語法帶到這個指令上，重用原生的衝突偵測、when 條件編輯等功能。
export async function configurePunctuationSuggestKeybinding(): Promise<void> {
  await vscode.commands.executeCommand(
    "workbench.action.openGlobalKeybindings",
    "@command:novelTranslate.suggestPunctuationFromOriginal"
  );
}
