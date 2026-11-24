import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { CompareView } from "../compareView/compareView";
import { openCompareView, revealCompareLine } from "../compareView/compareCommands";
import { ProjectStore } from "../core/projectStore";
import { safeRun } from "../core/safeRun";
import { searchAllWorks } from "./searchService";

type WebviewMessage =
  | { type: "ready" }
  | { type: "search"; query: string }
  | { type: "openResult"; workId: string; chapterId: string; line: number };

/**
 * 同時搜尋所有作品的原文與譯文，結果以「原文｜譯文｜章節」並排顯示，點擊即可跳到比對畫面的該行。
 * 這是查「這個詞之前怎麼翻」的主要入口（規格見 PLAN.md 1.6）。
 */
export class SearchPanel {
  private static current: SearchPanel | undefined;

  static createOrShow(store: ProjectStore | undefined, compareView: CompareView): void {
    if (!store) {
      vscode.window.showErrorMessage("請先開啟一個工作區資料夾。");
      return;
    }

    if (SearchPanel.current) {
      SearchPanel.current.panel.reveal(vscode.ViewColumn.Active);
      return;
    }

    const panel = vscode.window.createWebviewPanel("novelTranslate.search", "全作品搜尋", vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true
    });

    SearchPanel.current = new SearchPanel(panel, store, compareView);
  }

  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly store: ProjectStore,
    private readonly compareView: CompareView
  ) {
    this.panel.webview.onDidReceiveMessage(
      (message: WebviewMessage) => safeRun(this.runMessage(message), "處理全作品搜尋頁面訊息"),
      undefined,
      this.disposables
    );
    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
    this.panel.webview.html = this.renderHtml();
  }

  private dispose(): void {
    SearchPanel.current = undefined;
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }

  private async runMessage(message: WebviewMessage): Promise<void> {
    try {
      await this.handleMessage(message);
    } catch (error) {
      vscode.window.showErrorMessage(`搜尋失敗：${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case "ready":
        return;
      case "search": {
        const results = await searchAllWorks(this.store, message.query);
        void this.panel.webview.postMessage({ type: "results", query: message.query, results });
        return;
      }
      case "openResult": {
        const config = await this.store.load();
        const chapter = config.works
          .find((work) => work.id === message.workId)
          ?.chapters.find((candidate) => candidate.id === message.chapterId);
        if (!chapter) {
          vscode.window.showErrorMessage("找不到這個章節，可能已被刪除或重新命名。");
          return;
        }
        await openCompareView(this.store, this.compareView, chapter);
        revealCompareLine(this.compareView, message.line);
        return;
      }
    }
  }

  private renderHtml(): string {
    const nonce = randomBytes(16).toString("hex");
    const csp = [
      "default-src 'none'",
      `style-src ${this.panel.webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`
    ].join("; ");

    return /* html */ `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>全作品搜尋</title>
<style>
  [hidden] { display: none !important; }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    padding: 16px 24px;
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    background-color: var(--vscode-editor-background);
  }
  .search-bar { display: flex; gap: 8px; max-width: 640px; }
  #queryInput {
    flex: 1 1 auto;
    background-color: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    padding: 6px 10px;
    font: inherit;
  }
  button {
    background-color: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    padding: 6px 14px;
    cursor: pointer;
    font: inherit;
  }
  button:hover { background-color: var(--vscode-button-hoverBackground); }
  button:focus-visible, input:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: 1px;
  }
  .hint, .status { margin-top: 10px; color: var(--vscode-descriptionForeground); }
  #resultList { margin: 16px 0 0; padding: 0; list-style: none; }
  .result-row {
    display: block;
    width: 100%;
    padding: 10px 12px;
    margin-bottom: 6px;
    border: 1px solid var(--vscode-panel-border);
    background: transparent;
    color: var(--vscode-foreground);
    text-align: left;
    cursor: pointer;
  }
  .result-row:hover { background-color: var(--vscode-list-hoverBackground); }
  .result-location { font-size: 0.85em; color: var(--vscode-descriptionForeground); margin-bottom: 4px; }
  .result-lines { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .result-text { overflow-wrap: anywhere; }
  .result-text mark {
    background-color: var(--vscode-editor-findMatchHighlightBackground, rgba(234, 92, 0, 0.33));
    color: inherit;
  }
  .result-empty { opacity: 0.7; font-style: italic; }
  @media (max-width: 560px) {
    .result-lines { grid-template-columns: 1fr; gap: 4px; }
  }
</style>
</head>
<body>
  <div class="search-bar">
    <input id="queryInput" type="text" placeholder="輸入原文或譯文的關鍵字..." aria-label="搜尋關鍵字" autofocus />
    <button id="searchButton">搜尋</button>
  </div>
  <div id="statusText" class="status"></div>
  <ol id="resultList" aria-label="搜尋結果"></ol>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const byId = (id) => document.getElementById(id);
  const queryInput = byId("queryInput");
  const resultList = byId("resultList");
  const statusText = byId("statusText");
  let searching = false;

  function escapeHtml(text) {
    return text.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]));
  }

  function highlight(text, query) {
    const original = text || "";
    const trimmed = query.trim();
    const empty = "<span class=\\"result-empty\\">（空白）</span>";
    if (!trimmed) {
      return original ? escapeHtml(original) : empty;
    }
    const lowerText = original.toLowerCase();
    const lowerQuery = trimmed.toLowerCase();
    let html = "";
    let cursor = 0;
    let matchIndex = lowerText.indexOf(lowerQuery, cursor);
    if (matchIndex === -1) {
      return original ? escapeHtml(original) : empty;
    }
    while (matchIndex !== -1) {
      html += escapeHtml(original.slice(cursor, matchIndex));
      html += "<mark>" + escapeHtml(original.slice(matchIndex, matchIndex + trimmed.length)) + "</mark>";
      cursor = matchIndex + trimmed.length;
      matchIndex = lowerText.indexOf(lowerQuery, cursor);
    }
    html += escapeHtml(original.slice(cursor));
    return html;
  }

  function runSearch() {
    const query = queryInput.value.trim();
    if (!query) {
      resultList.replaceChildren();
      statusText.textContent = "";
      return;
    }
    searching = true;
    statusText.textContent = "搜尋中...";
    vscode.postMessage({ type: "search", query });
  }

  byId("searchButton").addEventListener("click", runSearch);
  queryInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      runSearch();
    }
  });

  resultList.addEventListener("click", (event) => {
    const row = event.target.closest("button[data-work-id]");
    if (!row) {
      return;
    }
    vscode.postMessage({
      type: "openResult",
      workId: row.dataset.workId,
      chapterId: row.dataset.chapterId,
      line: Number(row.dataset.line)
    });
  });

  window.addEventListener("message", (event) => {
    if (event.data.type !== "results" || event.data.query !== queryInput.value.trim()) {
      return;
    }
    searching = false;
    const results = event.data.results;
    resultList.replaceChildren();
    if (results.length === 0) {
      statusText.textContent = "沒有符合的結果。";
      return;
    }
    statusText.textContent = "共 " + results.length + " 筆結果。";
    for (const result of results) {
      const item = document.createElement("li");
      const row = document.createElement("button");
      row.className = "result-row";
      row.dataset.workId = result.workId;
      row.dataset.chapterId = result.chapterId;
      row.dataset.line = String(result.line);

      const location = document.createElement("div");
      location.className = "result-location";
      location.textContent = result.workTitle + " · " + result.chapterTitle + " · 第 " + (result.line + 1) + " 行";
      row.appendChild(location);

      const lines = document.createElement("div");
      lines.className = "result-lines";
      const original = document.createElement("div");
      original.className = "result-text";
      original.innerHTML = highlight(result.original, event.data.query);
      const translation = document.createElement("div");
      translation.className = "result-text";
      translation.innerHTML = highlight(result.translation, event.data.query);
      lines.append(original, translation);
      row.appendChild(lines);

      item.appendChild(row);
      resultList.appendChild(item);
    }
  });

  vscode.postMessage({ type: "ready" });
</script>
</body>
</html>`;
  }
}
