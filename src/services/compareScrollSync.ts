import * as vscode from "vscode";

// 使用者可以接受的行數誤差（AtTop 的實際落點不保證跟要求的行數完全一致）。
const LINE_TOLERANCE = 1;
// 單一次同步收到回音後，若還沒落在容許誤差內，最多再補發幾次請求（避免異常情況下無限重試）。
const MAX_RETRIES = 3;

interface InFlightReveal {
  requestedLine: number; // 實際送進 revealRange 的行數（已套用偏差校正）
  desiredLine: number; // 真正想要落在哪一行（校正前，已依文件長度夾過）
  attempts: number;
}

export class CompareScrollSync implements vscode.Disposable {
  private originalUri: string | undefined;
  private translationUri: string | undefined;
  private readonly subscription: vscode.Disposable;
  // 每個 uri 同時間最多只有一筆「尚未收到回音」的 revealRange 請求。
  private readonly inFlight = new Map<string, InFlightReveal>();
  // 回音抵達前，若又有更新的需求進來，先排隊，等回音處理完才套用最新值，
  // 避免同時對同一個 uri 疊加發出多筆請求（回音跟請求會對不上，越修正誤差越大）。
  private readonly queued = new Map<string, number>();
  // 持續學習 revealRange(AtTop) 實際落點跟要求行數之間的偏差，每次乾淨的回音都會更新，
  // 之後每一次請求（包含排隊中的）都會先扣掉這個偏差，讓結果即使在連續捲動中也能收斂。
  private readonly bias = new Map<string, number>();

  constructor() {
    this.subscription = vscode.window.onDidChangeTextEditorVisibleRanges((event) => this.handleChange(event));
  }

  setPair(originalUri: vscode.Uri, translationUri: vscode.Uri): void {
    this.originalUri = originalUri.toString();
    this.translationUri = translationUri.toString();
    this.inFlight.clear();
    this.queued.clear();
    this.bias.clear();

    // 一開啟就先預熱偏差學習值，使用者不用先捲動個幾次「暖身」才會開始準確同步。
    this.calibrate(this.originalUri);
    this.calibrate(this.translationUri);
  }

  // 刻意把畫面跳到遠離目前位置的探測行數，量出 revealRange(AtTop) 的實際落點偏差，
  // 再用剛學到的偏差把畫面準確地跳回原本的位置。使用者感覺不到這個過程（瞬間完成），
  // 但往後第一次真正捲動時，偏差值就已經準備好了。
  private calibrate(uri: string): void {
    const editor = vscode.window.visibleTextEditors.find((candidate) => candidate.document.uri.toString() === uri);
    if (!editor) {
      return;
    }

    const maxLine = Math.max(editor.document.lineCount - 1, 0);
    const currentLine = editor.visibleRanges[0]?.start.line ?? 0;
    const probeOffset = Math.min(10, maxLine);
    if (probeOffset === 0) {
      return;
    }

    const forwardProbe = currentLine + probeOffset;
    const probeLine = forwardProbe <= maxLine ? forwardProbe : Math.max(currentLine - probeOffset, 0);
    if (probeLine === currentLine) {
      return;
    }

    this.inFlight.set(uri, { requestedLine: probeLine, desiredLine: currentLine, attempts: 0 });
    editor.revealRange(new vscode.Range(probeLine, 0, probeLine, 0), vscode.TextEditorRevealType.AtTop);
  }

  dispose(): void {
    this.subscription.dispose();
  }

  private handleChange(event: vscode.TextEditorVisibleRangesChangeEvent): void {
    if (!this.originalUri || !this.translationUri) {
      return;
    }

    const sourceUri = event.textEditor.document.uri.toString();
    const topLine = event.visibleRanges[0]?.start.line;
    if (topLine === undefined) {
      return;
    }

    const inFlight = this.inFlight.get(sourceUri);
    if (inFlight) {
      // 這是我們自己對 sourceUri 發出的 revealRange 造成的回音，不往回同步到另一側。
      this.inFlight.delete(sourceUri);
      // 用這次乾淨對應的「要求 / 實際落點」更新偏差學習值。
      this.bias.set(sourceUri, topLine - inFlight.requestedLine);

      const queuedLine = this.queued.get(sourceUri);
      this.queued.delete(sourceUri);
      if (queuedLine !== undefined) {
        this.requestReveal(sourceUri, queuedLine, 0);
      } else if (Math.abs(topLine - inFlight.desiredLine) > LINE_TOLERANCE && inFlight.attempts < MAX_RETRIES) {
        // 沒有新需求排隊，但偏差校正後仍未落在容許範圍內，用剛更新的偏差值再補發一次。
        this.requestReveal(sourceUri, inFlight.desiredLine, inFlight.attempts + 1);
      }
      return;
    }

    const targetUri =
      sourceUri === this.originalUri
        ? this.translationUri
        : sourceUri === this.translationUri
          ? this.originalUri
          : undefined;
    if (!targetUri) {
      return;
    }

    const targetEditor = vscode.window.visibleTextEditors.find(
      (editor) => editor.document.uri.toString() === targetUri
    );
    if (!targetEditor) {
      return;
    }

    const desiredLine = Math.min(topLine, Math.max(targetEditor.document.lineCount - 1, 0));

    if (this.inFlight.has(targetUri)) {
      // 目標還在等待上一筆 revealRange 的回音，先排隊，等那筆回音處理完再套用最新值。
      this.queued.set(targetUri, desiredLine);
      return;
    }

    this.requestReveal(targetUri, desiredLine, 0);
  }

  private requestReveal(uri: string, desiredLine: number, attempts: number): void {
    const editor = vscode.window.visibleTextEditors.find((candidate) => candidate.document.uri.toString() === uri);
    if (!editor) {
      return;
    }

    const maxLine = Math.max(editor.document.lineCount - 1, 0);
    const clampedDesired = Math.min(Math.max(desiredLine, 0), maxLine);

    const currentLine = editor.visibleRanges[0]?.start.line;
    if (currentLine !== undefined && Math.abs(currentLine - clampedDesired) <= LINE_TOLERANCE) {
      // 已經在容許誤差內了：不要再送出一次不會改變畫面的 revealRange，
      // 那樣永遠收不到回音，會讓這個 uri 的 inFlight 狀態卡住，之後都無法再同步。
      return;
    }

    const bias = this.bias.get(uri) ?? 0;
    const requestedLine = Math.min(Math.max(clampedDesired - bias, 0), maxLine);

    this.inFlight.set(uri, { requestedLine, desiredLine: clampedDesired, attempts });
    editor.revealRange(new vscode.Range(requestedLine, 0, requestedLine, 0), vscode.TextEditorRevealType.AtTop);
  }
}
