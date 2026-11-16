import * as vscode from "vscode";
import { ProjectStore } from "../services/projectStore";
import { CompareView } from "./compareView";
import { ChapterConfig } from "../types";
import { COMPARE_TRANSLATION_ON_LEFT_SETTING_KEY } from "../constants";

export async function openCompareView(
  store: ProjectStore | undefined,
  compareView: CompareView,
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

  await compareView.open(originalUri, translationUri);
}

// VS Code 重新啟動時可能會自動還原上次開啟的分頁，這些分頁並不是透過 openCompareView() 開啟的，
// 所以 CompareView 的 pair 狀態是空的，導致所有同步相關事件都被忽略，要手動關閉再重開才會恢復正常。
// 掃描目前所有可見分頁，找出剛好同時開著某一章節原文＋譯文的情況，直接登記成目前的比對配對。
export async function restoreComparePairIfOpen(
  store: ProjectStore | undefined,
  compareView: CompareView
): Promise<boolean> {
  if (!store) {
    return false;
  }

  const config = await store.load();
  const visibleUris = new Set(vscode.window.visibleTextEditors.map((editor) => editor.document.uri.toString()));

  for (const work of config.works) {
    for (const chapter of work.chapters) {
      const originalUri = store.resolveUri(chapter.originalPath);
      const translationUri = store.resolveUri(chapter.translationPath);
      if (visibleUris.has(originalUri.toString()) && visibleUris.has(translationUri.toString())) {
        compareView.adoptPair(originalUri, translationUri);
        return true;
      }
    }
  }
  return false;
}

// 讓使用者透過命令面板（Ctrl+Shift+P）或設置面板的核取方塊切換比對畫面的左右配置，
// 設定值會立即寫回 workspace，下一次開啟比對畫面時套用新的版面。
export async function toggleCompareLayout(): Promise<void> {
  const config = vscode.workspace.getConfiguration();
  const translationOnLeft = config.get<boolean>(COMPARE_TRANSLATION_ON_LEFT_SETTING_KEY, true);
  const nextTranslationOnLeft = !translationOnLeft;
  await config.update(COMPARE_TRANSLATION_ON_LEFT_SETTING_KEY, nextTranslationOnLeft, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(
    nextTranslationOnLeft
      ? "已切換為「翻譯在左、原文在右」，下次開啟比對畫面時套用。"
      : "已切換為「原文在左、翻譯在右」，下次開啟比對畫面時套用。"
  );
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
