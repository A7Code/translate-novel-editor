import * as vscode from "vscode";
import { CompareSide, CompareView, otherCompareSide } from "../compareView";

// 控制比對畫面是否要把其中一側的游標行同步到另一側的設定鍵，預設開啟。
export const CURSOR_SYNC_ENABLED_SETTING_KEY = "novelTranslate.compareCursorSync.enabled";

// VS Code 本身就會把非焦點編輯器的目前行用較淡的樣式標示，即使該編輯器已失焦也會保留，
// 所以這裡不需要自己畫高光，只要把另一側的游標實際移到對應行，就能借用編輯器原生的樣式呈現。
//
// 只有在設定開啟時才向 CompareView 註冊監聽，設定關閉就把訂閱全部取消。
export class CursorSyncExtension implements vscode.Disposable {
  private readonly configSubscription: vscode.Disposable;
  private registrations: vscode.Disposable[] = [];

  constructor(private readonly compareView: CompareView) {
    this.configSubscription = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(CURSOR_SYNC_ENABLED_SETTING_KEY)) {
        this.applyEnabledSetting();
      }
    });
    this.applyEnabledSetting();
  }

  dispose(): void {
    this.configSubscription.dispose();
    this.deactivate();
  }

  private applyEnabledSetting(): void {
    const enabled = vscode.workspace.getConfiguration().get<boolean>(CURSOR_SYNC_ENABLED_SETTING_KEY, true);
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
      this.compareView.onDidMoveIndex((event) => this.syncTarget(event.side, event.line)),
      // 開啟比對畫面、切換焦點編輯器、或重新開啟設定時，立即用目前焦點編輯器的游標行校正一次，
      // 不用等使用者先移動一次游標才會同步。
      this.compareView.onDidSetPair(() => this.syncFromActiveEditor()),
      this.compareView.onDidChangeVisibility(() => this.syncFromActiveEditor())
    ];
    this.syncFromActiveEditor();
  }

  private deactivate(): void {
    for (const registration of this.registrations) {
      registration.dispose();
    }
    this.registrations = [];
  }

  private syncFromActiveEditor(): void {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      return;
    }
    const side = this.compareView.sideOf(activeEditor.document.uri);
    if (!side) {
      return;
    }
    this.syncTarget(side, activeEditor.selection.active.line);
  }

  // 兩側誰移動游標就同步到另一側（跟 scrollSyncExtension 一致的對稱式設計）。
  // sourceSide 一定是目前真正 focus 的那一側：CompareView 只會在 onDidMoveIndex 對
  // 目前 focus 的編輯器觸發，所以這裡寫入 targetEditor.selection 造成的回音事件
  // 不會再被 CompareView 往下派送，不需要自己額外偵測、吃掉回音。
  private syncTarget(sourceSide: CompareSide, line: number): void {
    const targetSide = otherCompareSide(sourceSide);
    const targetEditor = this.compareView.editorFor(targetSide);
    if (!targetEditor) {
      return;
    }

    // targetEditor 是透過 CompareView.editorFor() 從 visibleTextEditors 當下查出來的，
    // 在分頁正在開啟／替換的過渡期，這個參照可能在拿到之後、實際寫入 selection 之前
    // 就被 VS Code 內部處置掉，直接操作會丟例外，接住避免波及其他功能。
    try {
      const clampedLine = Math.min(Math.max(line, 0), Math.max(targetEditor.document.lineCount - 1, 0));
      if (targetEditor.selection.isEmpty && targetEditor.selection.active.line === clampedLine) {
        return;
      }

      const position = new vscode.Position(clampedLine, 0);
      targetEditor.selection = new vscode.Selection(position, position);
    } catch (error) {
      console.error("[novelTranslate] 同步游標位置時發生未預期的錯誤：", error);
    }
  }
}
