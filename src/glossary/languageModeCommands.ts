import * as vscode from "vscode";
import { GLOSSARY_AUTOCOMPLETE_ENABLED_SETTING_KEY, TRANSLATION_LANGUAGE_ID } from "../constants";
import { ProjectStore } from "../services/projectStore";

export async function toggleAutocompleteMode(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage("請先開啟一個編輯器分頁。");
    return;
  }

  const nextLanguageId = editor.document.languageId === TRANSLATION_LANGUAGE_ID ? "plaintext" : TRANSLATION_LANGUAGE_ID;
  await vscode.languages.setTextDocumentLanguage(editor.document, nextLanguageId);
  vscode.window.showInformationMessage(
    nextLanguageId === TRANSLATION_LANGUAGE_ID
      ? "已切換為詞彙表自動完成模式，一般自動完成已暫時停用。"
      : "已切換回一般自動完成模式。"
  );
}

// 設定變更時，把目前所有已開啟、屬於某個章節的原文／譯文分頁立即套用對應語言模式，
// 不然勾選框切換後要等使用者重新開啟比對畫面才會生效，看起來就像設定沒有作用。
export async function syncGlossaryAutocompleteLanguageMode(store: ProjectStore | undefined): Promise<void> {
  if (!store) {
    return;
  }

  const enabled = vscode.workspace.getConfiguration().get<boolean>(GLOSSARY_AUTOCOMPLETE_ENABLED_SETTING_KEY, true);
  const targetLanguageId = enabled ? TRANSLATION_LANGUAGE_ID : "plaintext";

  for (const document of vscode.workspace.textDocuments) {
    if (document.languageId === targetLanguageId) {
      continue;
    }
    const workId = await store.findWorkIdForDocumentUri(document.uri);
    if (!workId) {
      continue;
    }
    await vscode.languages.setTextDocumentLanguage(document, targetLanguageId);
  }
}
