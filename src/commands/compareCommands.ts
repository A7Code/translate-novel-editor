import * as vscode from "vscode";
import { ProjectStore } from "../services/projectStore";
import { CompareScrollSync } from "../services/compareScrollSync";
import { ChapterConfig } from "../types";
import { GLOSSARY_AUTOCOMPLETE_ENABLED_SETTING_KEY, TRANSLATION_LANGUAGE_ID } from "../constants";

export async function openCompareView(
  store: ProjectStore | undefined,
  scrollSync: CompareScrollSync,
  chapter?: ChapterConfig
): Promise<void> {
  if (!store) {
    vscode.window.showErrorMessage("請先開啟一個工作區資料夾。");
    return;
  }

  const resolvedChapter = chapter ?? (await pickChapter(store));
  if (!resolvedChapter) {
    return;
  }

  const originalUri = store.resolveUri(resolvedChapter.originalPath);
  const translationUri = store.resolveUri(resolvedChapter.translationPath);
  const glossaryAutocompleteEnabled = vscode.workspace
    .getConfiguration()
    .get<boolean>(GLOSSARY_AUTOCOMPLETE_ENABLED_SETTING_KEY, true);

  let originalDocument = await vscode.workspace.openTextDocument(originalUri);
  if (glossaryAutocompleteEnabled && originalDocument.languageId !== TRANSLATION_LANGUAGE_ID) {
    originalDocument = await vscode.languages.setTextDocumentLanguage(originalDocument, TRANSLATION_LANGUAGE_ID);
  }
  await vscode.window.showTextDocument(originalDocument, {
    viewColumn: vscode.ViewColumn.One,
    preview: false
  });
  await vscode.commands.executeCommand("workbench.action.files.setActiveEditorReadonlyInSession");

  let translationDocument = await vscode.workspace.openTextDocument(translationUri);
  if (glossaryAutocompleteEnabled && translationDocument.languageId !== TRANSLATION_LANGUAGE_ID) {
    translationDocument = await vscode.languages.setTextDocumentLanguage(translationDocument, TRANSLATION_LANGUAGE_ID);
  }
  await vscode.window.showTextDocument(translationDocument, {
    viewColumn: vscode.ViewColumn.Two,
    preview: false
  });

  scrollSync.setPair(originalUri, translationUri);
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

async function pickChapter(store: ProjectStore): Promise<ChapterConfig | undefined> {
  const config = await store.load();
  if (config.works.length === 0) {
    vscode.window.showErrorMessage("請先建立作品與章節。");
    return undefined;
  }

  const workPick = await vscode.window.showQuickPick(
    config.works.map((work) => ({ label: work.title, work })),
    { placeHolder: "選擇作品" }
  );
  if (!workPick) {
    return undefined;
  }
  if (workPick.work.chapters.length === 0) {
    vscode.window.showErrorMessage("這個作品還沒有章節。");
    return undefined;
  }

  const chapterPick = await vscode.window.showQuickPick(
    workPick.work.chapters.map((chapter) => ({ label: chapter.title, chapter })),
    { placeHolder: "選擇章節" }
  );
  return chapterPick?.chapter;
}
