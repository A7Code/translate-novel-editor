import * as vscode from "vscode";
import { safeRun } from "../../core/safeRun";
import { findLineAlignmentIssues } from "../../translation/progress";
import { CompareEditorPair, CompareView } from "../compareView";

// 控制是否在 Problems 面板提示行數對齊問題（B6）的設定鍵，預設開啟。
export const LINE_ALIGNMENT_CHECK_ENABLED_SETTING_KEY = "novelTranslate.lineAlignmentCheck.enabled";

const DEBOUNCE_MS = 300;

/**
 * 只檢查目前開著的比對配對，跟 cursorSyncExtension／scrollSyncExtension 一樣是「掛在
 * CompareView 上」的擴充功能：設定關閉時完全不註冊監聽，也不留下任何診斷。
 * 偵測邏輯本身（哪些情況算對齊問題）在 translation/progress.ts 的 findLineAlignmentIssues，
 * 這裡只負責決定何時重新檢查，以及把結果轉成 vscode.Diagnostic 顯示在譯文檔案上。
 */
export class LineAlignmentDiagnosticsExtension implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection("novelTranslate.lineAlignment");
  private readonly configSubscription: vscode.Disposable;
  private registrations: vscode.Disposable[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly compareView: CompareView) {
    this.configSubscription = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(LINE_ALIGNMENT_CHECK_ENABLED_SETTING_KEY)) {
        this.applyEnabledSetting();
      }
    });
    this.applyEnabledSetting();
  }

  dispose(): void {
    this.configSubscription.dispose();
    this.deactivate();
    this.collection.dispose();
  }

  private applyEnabledSetting(): void {
    const enabled = vscode.workspace.getConfiguration().get<boolean>(LINE_ALIGNMENT_CHECK_ENABLED_SETTING_KEY, true);
    if (enabled) {
      this.activate();
    } else {
      this.deactivate();
    }
  }

  private activate(): void {
    if (this.registrations.length > 0) {
      return;
    }
    this.registrations = [
      this.compareView.onDidSetPair(() => this.scheduleCheck()),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (this.compareView.sideOf(event.document.uri)) {
          this.scheduleCheck();
        }
      })
    ];
    this.scheduleCheck();
  }

  private deactivate(): void {
    for (const registration of this.registrations) {
      registration.dispose();
    }
    this.registrations = [];
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.collection.clear();
  }

  private scheduleCheck(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      safeRun(this.check(), "檢查行數對齊");
    }, DEBOUNCE_MS);
  }

  private async check(): Promise<void> {
    const pair = this.compareView.currentPair;
    if (!pair) {
      this.collection.clear();
      return;
    }

    const [originalDocument, translationDocument] = await Promise.all([
      vscode.workspace.openTextDocument(pair.originalUri),
      vscode.workspace.openTextDocument(pair.translationUri)
    ]);
    // 這段 await 期間使用者可能已經切換到別的配對，不能用舊配對算出來的結果覆蓋現況。
    if (!this.isSamePair(this.compareView.currentPair, pair)) {
      return;
    }

    const issues = findLineAlignmentIssues(originalDocument.getText(), translationDocument.getText());
    const diagnostics = issues.map((issue) => {
      const line = Math.min(issue.line, Math.max(translationDocument.lineCount - 1, 0));
      const diagnostic = new vscode.Diagnostic(
        translationDocument.lineAt(line).range,
        issue.message,
        vscode.DiagnosticSeverity.Warning
      );
      diagnostic.source = "novelTranslate";
      return diagnostic;
    });
    // 只保留目前這對配對的診斷，切換章節後舊章節的提示不會留著。
    this.collection.clear();
    this.collection.set(translationDocument.uri, diagnostics);
  }

  private isSamePair(a: CompareEditorPair | undefined, b: CompareEditorPair): boolean {
    return !!a && a.originalUri.toString() === b.originalUri.toString() && a.translationUri.toString() === b.translationUri.toString();
  }
}
