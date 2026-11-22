import * as vscode from "vscode";
import { CompareView } from "../compareView/compareView";
import { ProjectStore } from "../core/projectStore";
import { safeRun } from "../core/safeRun";
import { ProgressService } from "./progressService";

/** 比對畫面開啟時，在狀態列顯示本章進度；點擊開啟該作品的管理頁面。 */
export class ProgressStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  private readonly subscriptions: vscode.Disposable[];
  private updateId = 0;

  constructor(
    private readonly store: ProjectStore,
    private readonly compareView: CompareView,
    private readonly progress: ProgressService
  ) {
    const update = () => safeRun(this.update(), "更新狀態列翻譯進度");
    this.subscriptions = [
      this.item,
      compareView.onDidSetPair(update),
      compareView.onDidChangeVisibility(update),
      progress.onDidChangeProgress(update)
    ];
    update();
  }

  dispose(): void {
    this.subscriptions.forEach((subscription) => subscription.dispose());
  }

  private async update(): Promise<void> {
    const updateId = ++this.updateId;
    const pair = this.compareView.currentPair;
    const isVisible = this.compareView.editorFor("original") || this.compareView.editorFor("translation");
    if (!pair || !isVisible) {
      this.item.hide();
      return;
    }

    const found = await this.store.findChapterForDocumentUri(pair.originalUri);
    if (!found) {
      if (updateId === this.updateId) {
        this.item.hide();
      }
      return;
    }

    let snapshot = this.progress.getSnapshot(found.workId);
    if (!snapshot?.chapters[found.chapter.id]) {
      snapshot = await this.progress.ensureWork(found.workId);
    }
    if (updateId !== this.updateId) {
      return;
    }

    const chapter = snapshot?.chapters[found.chapter.id];
    if (!chapter) {
      this.item.text = "本章進度無法讀取";
      this.item.tooltip = found.chapter.title;
    } else if (chapter.percent === null) {
      this.item.text = "本章無原文";
      this.item.tooltip = found.chapter.title;
    } else {
      const warning = chapter.extraTranslationLines > 0 ? " ⚠" : "";
      this.item.text = `本章 ${chapter.translatedLines}/${chapter.totalLines}（${chapter.percent}%）${warning}`;
      this.item.tooltip = warning
        ? `${found.chapter.title}：有 ${chapter.extraTranslationLines} 行譯文沒有對應原文`
        : found.chapter.title;
    }
    this.item.command = {
      command: "novelTranslate.openWorkManager",
      title: "開啟作品管理",
      arguments: [found.workId]
    };
    this.item.show();
  }
}
