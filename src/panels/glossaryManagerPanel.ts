import * as vscode from "vscode";
import { ProjectStore } from "../services/projectStore";
import { GlossaryEntry, WorkConfig } from "../types";
import {
  GlossaryEntryTreeItem,
  GlossaryTreeProvider,
  GlossaryWorkTreeItem
} from "../views/glossaryTreeProvider";
import { addGlossaryEntry, deleteGlossaryEntry, editGlossaryEntry } from "../commands/glossaryCommands";
import { searchGlossary } from "../services/glossarySearch";

type WebviewMessage =
  | { type: "ready" }
  | { type: "selectWork"; workId: string }
  | { type: "search"; query: string }
  | { type: "add" }
  | { type: "edit"; entryId: string }
  | { type: "delete"; entryId: string };

/**
 * 詞彙表在側邊欄受限於 TreeView，版面太窄放不下常駐搜尋欄。
 * 這個 WebviewPanel 在編輯器區域開一個完整版的詞彙管理畫面，
 * 新增／編輯／刪除直接重用既有的 glossaryCommands 流程，避免兩套邏輯。
 */
export class GlossaryManagerPanel {
  private static current: GlossaryManagerPanel | undefined;

  static createOrShow(
    store: ProjectStore | undefined,
    treeProvider: GlossaryTreeProvider,
    initialWorkId?: string
  ): void {
    if (!store) {
      vscode.window.showErrorMessage("請先開啟一個工作區資料夾。");
      return;
    }

    if (GlossaryManagerPanel.current) {
      GlossaryManagerPanel.current.panel.reveal(vscode.ViewColumn.Active);
      if (initialWorkId) {
        void GlossaryManagerPanel.current.selectWork(initialWorkId);
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "novelTranslate.glossaryManager",
      "詞彙管理",
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    GlossaryManagerPanel.current = new GlossaryManagerPanel(panel, store, treeProvider, initialWorkId);
  }

  private readonly disposables: vscode.Disposable[] = [];
  private selectedWorkId: string | undefined;
  private searchQuery = "";

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly store: ProjectStore,
    private readonly treeProvider: GlossaryTreeProvider,
    initialWorkId?: string
  ) {
    this.selectedWorkId = initialWorkId;
    this.panel.webview.html = this.renderHtml();
    this.panel.webview.onDidReceiveMessage(
      (message: WebviewMessage) => void this.handleMessage(message),
      undefined,
      this.disposables
    );
    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
  }

  private dispose(): void {
    GlossaryManagerPanel.current = undefined;
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }

  private async selectWork(workId: string): Promise<void> {
    this.selectedWorkId = workId;
    await this.postEntries();
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case "ready":
        await this.postInit();
        return;
      case "selectWork":
        await this.selectWork(message.workId);
        return;
      case "search":
        this.searchQuery = message.query;
        await this.postEntries();
        return;
      case "add": {
        const work = await this.requireSelectedWork();
        if (!work) {
          return;
        }
        await addGlossaryEntry(this.store, this.treeProvider, new GlossaryWorkTreeItem(work));
        await this.postEntries();
        return;
      }
      case "edit": {
        const entry = await this.findEntry(message.entryId);
        if (!entry || !this.selectedWorkId) {
          return;
        }
        await editGlossaryEntry(
          this.store,
          this.treeProvider,
          new GlossaryEntryTreeItem(this.selectedWorkId, entry)
        );
        await this.postEntries();
        return;
      }
      case "delete": {
        const entry = await this.findEntry(message.entryId);
        if (!entry || !this.selectedWorkId) {
          return;
        }
        await deleteGlossaryEntry(
          this.store,
          this.treeProvider,
          new GlossaryEntryTreeItem(this.selectedWorkId, entry)
        );
        await this.postEntries();
        return;
      }
    }
  }

  private async getSelectedWork(): Promise<WorkConfig | undefined> {
    const config = await this.store.load();
    return config.works.find((candidate) => candidate.id === this.selectedWorkId);
  }

  private async requireSelectedWork(): Promise<WorkConfig | undefined> {
    const work = await this.getSelectedWork();
    if (!work) {
      vscode.window.showErrorMessage("請先選擇作品。");
      return undefined;
    }
    return work;
  }

  private async findEntry(entryId: string): Promise<GlossaryEntry | undefined> {
    const work = await this.getSelectedWork();
    return work?.glossary.find((entry) => entry.id === entryId);
  }

  private async postInit(): Promise<void> {
    const config = await this.store.load();
    if (!this.selectedWorkId || !config.works.some((work) => work.id === this.selectedWorkId)) {
      this.selectedWorkId = config.works[0]?.id;
    }
    void this.panel.webview.postMessage({
      type: "init",
      works: config.works.map((work) => ({ id: work.id, title: work.title })),
      selectedWorkId: this.selectedWorkId
    });
    await this.postEntries();
  }

  private async postEntries(): Promise<void> {
    const work = await this.getSelectedWork();
    void this.panel.webview.postMessage({
      type: "entries",
      results: searchGlossary(work?.glossary ?? [], this.searchQuery)
    });
  }

  private renderHtml(): string {
    const nonce = getNonce();
    const csp = [
      "default-src 'none'",
      `style-src ${this.panel.webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`
    ].join("; ");

    return /* html */ `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>詞彙管理</title>
<style>
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    background-color: var(--vscode-editor-background);
    padding: 0;
    margin: 0;
  }
  header {
    position: sticky;
    top: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    background-color: var(--vscode-editor-background);
    border-bottom: 1px solid var(--vscode-panel-border);
    z-index: 1;
  }
  header select {
    background-color: var(--vscode-dropdown-background);
    color: var(--vscode-dropdown-foreground);
    border: 1px solid var(--vscode-dropdown-border);
    padding: 4px 6px;
  }
  header input[type="text"] {
    flex: 1 1 auto;
    max-width: 320px;
    background-color: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    padding: 4px 8px;
  }
  header input[type="text"]:focus {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }
  mark {
    background-color: var(--vscode-editor-findMatchHighlightBackground, #ea5c0055);
    color: inherit;
    border-radius: 2px;
  }
  button {
    background-color: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    padding: 4px 10px;
    cursor: pointer;
  }
  button:hover {
    background-color: var(--vscode-button-hoverBackground);
  }
  button.secondary {
    background-color: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  button.secondary:hover {
    background-color: var(--vscode-button-secondaryHoverBackground);
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th, td {
    text-align: left;
    padding: 6px 16px;
    border-bottom: 1px solid var(--vscode-panel-border);
    vertical-align: top;
  }
  th {
    color: var(--vscode-descriptionForeground);
    font-weight: normal;
  }
  td.actions {
    white-space: nowrap;
    text-align: right;
  }
  td.actions button {
    margin-left: 4px;
  }
  .empty {
    padding: 24px 16px;
    color: var(--vscode-descriptionForeground);
  }
</style>
</head>
<body>
  <header>
    <select id="workSelect"></select>
    <input id="searchInput" type="text" placeholder="搜尋原文／譯文..." />
    <span style="flex: 1 1 auto"></span>
    <button id="addButton">新增詞條</button>
  </header>
  <table>
    <thead>
      <tr>
        <th>原文</th>
        <th>譯文</th>
        <th>分類</th>
        <th>備註</th>
        <th></th>
      </tr>
    </thead>
    <tbody id="entryList"></tbody>
  </table>
  <div id="emptyState" class="empty" hidden>這個作品還沒有詞條。</div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const workSelect = document.getElementById("workSelect");
  const searchInput = document.getElementById("searchInput");
  const addButton = document.getElementById("addButton");
  const entryList = document.getElementById("entryList");
  const emptyState = document.getElementById("emptyState");

  workSelect.addEventListener("change", () => {
    vscode.postMessage({ type: "selectWork", workId: workSelect.value });
  });

  let searchDebounce;
  searchInput.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    const query = searchInput.value;
    searchDebounce = setTimeout(() => {
      vscode.postMessage({ type: "search", query });
    }, 120);
  });

  addButton.addEventListener("click", () => {
    vscode.postMessage({ type: "add" });
  });

  entryList.addEventListener("click", (event) => {
    const target = event.target.closest("button[data-action]");
    if (!target) {
      return;
    }
    const entryId = target.getAttribute("data-entry-id");
    const action = target.getAttribute("data-action");
    vscode.postMessage({ type: action, entryId });
  });

  function renderWorks(works, selectedWorkId) {
    workSelect.innerHTML = "";
    for (const work of works) {
      const option = document.createElement("option");
      option.value = work.id;
      option.textContent = work.title;
      option.selected = work.id === selectedWorkId;
      workSelect.appendChild(option);
    }
    workSelect.hidden = works.length <= 1;
  }

  function renderHighlighted(match) {
    const fragment = document.createDocumentFragment();
    const sorted = [...match.highlights].sort((a, b) => a[0] - b[0]);
    let cursor = 0;
    for (const [start, length] of sorted) {
      if (start > cursor) {
        fragment.appendChild(document.createTextNode(match.text.slice(cursor, start)));
      }
      const mark = document.createElement("mark");
      mark.textContent = match.text.slice(start, start + length);
      fragment.appendChild(mark);
      cursor = start + length;
    }
    if (cursor < match.text.length) {
      fragment.appendChild(document.createTextNode(match.text.slice(cursor)));
    }
    return fragment;
  }

  function renderEntries(results) {
    entryList.innerHTML = "";
    emptyState.hidden = results.length > 0;
    emptyState.textContent = searchInput.value.trim() ? "沒有符合的詞條。" : "這個作品還沒有詞條。";
    for (const result of results) {
      const entry = result.entry;
      const row = document.createElement("tr");

      const termCell = document.createElement("td");
      termCell.appendChild(renderHighlighted(result.term));
      row.appendChild(termCell);

      const translationCell = document.createElement("td");
      translationCell.appendChild(renderHighlighted(result.translation));
      row.appendChild(translationCell);

      const categoryCell = document.createElement("td");
      categoryCell.textContent = entry.category ?? "";
      row.appendChild(categoryCell);

      const noteCell = document.createElement("td");
      noteCell.textContent = entry.note ?? "";
      row.appendChild(noteCell);

      const actionsCell = document.createElement("td");
      actionsCell.className = "actions";

      const editButton = document.createElement("button");
      editButton.className = "secondary";
      editButton.textContent = "編輯";
      editButton.setAttribute("data-action", "edit");
      editButton.setAttribute("data-entry-id", entry.id);
      actionsCell.appendChild(editButton);

      const deleteButton = document.createElement("button");
      deleteButton.className = "secondary";
      deleteButton.textContent = "刪除";
      deleteButton.setAttribute("data-action", "delete");
      deleteButton.setAttribute("data-entry-id", entry.id);
      actionsCell.appendChild(deleteButton);

      row.appendChild(actionsCell);
      entryList.appendChild(row);
    }
  }

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type === "init") {
      renderWorks(message.works, message.selectedWorkId);
    } else if (message.type === "entries") {
      renderEntries(message.results);
    }
  });

  vscode.postMessage({ type: "ready" });
</script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
