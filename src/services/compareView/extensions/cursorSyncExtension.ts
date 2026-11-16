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
  // 記錄我們自己剛對哪一側下達過同步指令、同步到第幾行。VS Code 觸發 selection 變動事件是非同步的，
  // 單純比較「目標現在是不是已經在那一行」並不夠可靠（例如目標當下仍殘留非空選取範圍時一定會被
  // 判定要覆寫），所以改成明確標記「這筆即將發生的事件是我們自己造成的」，收到時直接吃掉、
  // 不再往回同步，才能從根本阻斷兩側互相觸發的迴圈，不依賴猜測目標目前的選取狀態。
  private readonly pendingSyncLine = new Map<CompareSide, number>();

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
    this.pendingSyncLine.clear();
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
  private syncTarget(sourceSide: CompareSide, line: number): void {
    // 如果這筆事件剛好是我們自己對 sourceSide 下達同步指令所造成的回音，直接吃掉，
    // 不要再往回同步到另一側——這是避免兩側互相觸發無窮迴圈的關鍵，不能只靠猜測
    // 目標當下的選取狀態是否「看起來」已經一致。
    const pendingLine = this.pendingSyncLine.get(sourceSide);
    if (pendingLine !== undefined) {
      this.pendingSyncLine.delete(sourceSide);
      if (pendingLine === line) {
        return;
      }
    }

    const targetSide = otherCompareSide(sourceSide);
    const targetEditor = this.compareView.editorFor(targetSide);
    if (!targetEditor) {
      return;
    }

    const clampedLine = Math.min(Math.max(line, 0), Math.max(targetEditor.document.lineCount - 1, 0));
    if (targetEditor.selection.isEmpty && targetEditor.selection.active.line === clampedLine) {
      return;
    }

    const position = new vscode.Position(clampedLine, 0);
    this.pendingSyncLine.set(targetSide, clampedLine);
    targetEditor.selection = new vscode.Selection(position, position);
  }
}
