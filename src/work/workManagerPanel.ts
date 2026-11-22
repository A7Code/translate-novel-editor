import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { CompareView } from "../compareView/compareView";
import { openCompareView } from "../compareView/compareCommands";
import { ProjectStore } from "../core/projectStore";
import { safeRun } from "../core/safeRun";
import { WorkConfig } from "../core/types";
import { exportEpub, importEpub } from "../epub/epubCommands";
import { GlossaryManagerPanel } from "../glossary/glossaryManagerPanel";
import { GlossaryTreeProvider } from "../glossary/glossaryTreeProvider";
import { addChapter, createWork, importChapterFile } from "./workCommands";
import { WorkTreeItem, WorkTreeProvider } from "./workTreeProvider";

type WebviewMessage =
  | { type: "ready" }
  | { type: "selectWork"; workId: string }
  | { type: "addWork" }
  | { type: "importEpub" }
  | { type: "saveWork"; title: string; author: string; sourceLanguage: string; targetLanguage: string }
  | { type: "renameChapter"; chapterId: string; title: string }
  | { type: "addChapter" }
  | { type: "importChapterFile" }
  | { type: "exportEpub" }
  | { type: "openGlossary" }
  | { type: "openChapter"; chapterId: string };

interface WorkManagerDependencies {
  store: ProjectStore;
  workTreeProvider: WorkTreeProvider;
  glossaryTreeProvider: GlossaryTreeProvider;
  compareView: CompareView;
}

/**
 * 在編輯器區域開啟的作品管理畫面：左邊瀏覽所有作品，右邊看單一作品的資料與章節。
 * 所有操作都重用既有指令流程，資料異動則透過兩個 TreeProvider 的變更事件同步回畫面，
 * 所以不論從側邊欄或這個頁面操作，兩邊顯示都會一致。
 */
export class WorkManagerPanel {
  private static current: WorkManagerPanel | undefined;

  static createOrShow(
    store: ProjectStore | undefined,
    workTreeProvider: WorkTreeProvider,
    glossaryTreeProvider: GlossaryTreeProvider,
    compareView: CompareView,
    initialWorkId?: string
  ): void {
    if (!store) {
      vscode.window.showErrorMessage("請先開啟一個工作區資料夾。");
      return;
    }

    if (WorkManagerPanel.current) {
      WorkManagerPanel.current.panel.reveal(vscode.ViewColumn.Active);
      if (initialWorkId) {
        safeRun(WorkManagerPanel.current.selectWork(initialWorkId), "切換作品管理頁面的作品");
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "novelTranslate.workManager",
      "作品管理",
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    WorkManagerPanel.current = new WorkManagerPanel(
      panel,
      { store, workTreeProvider, glossaryTreeProvider, compareView },
      initialWorkId
    );
  }

  private readonly disposables: vscode.Disposable[] = [];
  private selectedWorkId: string | undefined;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly deps: WorkManagerDependencies,
    initialWorkId?: string
  ) {
    this.selectedWorkId = initialWorkId;
    const syncState = () => safeRun(this.postState(), "同步作品管理頁面");

    // 先掛好監聽才設定 html，避免 webview 的第一個 "ready" 訊息送出時還沒有人接收。
    this.panel.webview.onDidReceiveMessage(
      (message: WebviewMessage) => safeRun(this.runMessage(message), "處理作品管理頁面訊息"),
      undefined,
      this.disposables
    );
    this.deps.workTreeProvider.onDidChangeTreeData(syncState, undefined, this.disposables);
    this.deps.glossaryTreeProvider.onDidChangeTreeData(syncState, undefined, this.disposables);
    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
    this.panel.webview.html = this.renderHtml();
  }

  private dispose(): void {
    WorkManagerPanel.current = undefined;
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }

  private async selectWork(workId: string): Promise<void> {
    this.selectedWorkId = workId;
    await this.postState();
  }

  // 匯出、匯入這類操作失敗時，使用者需要看到原因，不能只留在主控台。
  private async runMessage(message: WebviewMessage): Promise<void> {
    try {
      await this.handleMessage(message);
    } catch (error) {
      vscode.window.showErrorMessage(`作品管理操作失敗：${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    const { store, workTreeProvider, glossaryTreeProvider, compareView } = this.deps;

    switch (message.type) {
      case "ready":
        await this.postState();
        return;
      case "selectWork":
        await this.selectWork(message.workId);
        return;
      case "addWork": {
        const work = await createWork(store, workTreeProvider, glossaryTreeProvider);
        if (work) {
          await this.selectWork(work.id);
        }
        return;
      }
      case "importEpub": {
        const existingIds = new Set((await store.load()).works.map((work) => work.id));
        await importEpub(store, workTreeProvider);
        glossaryTreeProvider.refresh();
        const imported = (await store.load()).works.find((work) => !existingIds.has(work.id));
        if (imported) {
          await this.selectWork(imported.id);
        }
        return;
      }
    }

    const work = await this.getSelectedWork();
    if (!work) {
      vscode.window.showErrorMessage("請先選擇作品。");
      return;
    }

    switch (message.type) {
      case "saveWork": {
        const title = message.title.trim();
        if (!title) {
          vscode.window.showErrorMessage("請輸入作品名稱。");
          return;
        }
        await store.updateWork(work.id, {
          title,
          author: message.author.trim() || undefined,
          sourceLanguage: message.sourceLanguage.trim() || undefined,
          targetLanguage: message.targetLanguage.trim() || undefined
        });
        workTreeProvider.refresh();
        glossaryTreeProvider.refresh();
        return;
      }
      case "renameChapter": {
        const title = message.title.trim();
        if (!title) {
          vscode.window.showErrorMessage("請輸入章節標題。");
          return;
        }
        await store.renameChapter(work.id, message.chapterId, title);
        workTreeProvider.refresh();
        return;
      }
      case "addChapter":
        await addChapter(store, workTreeProvider, compareView, new WorkTreeItem(work, false));
        return;
      case "importChapterFile":
        await importChapterFile(store, workTreeProvider, compareView, new WorkTreeItem(work, false));
        return;
      case "exportEpub":
        await exportEpub(store, new WorkTreeItem(work, false));
        return;
      case "openGlossary":
        GlossaryManagerPanel.createOrShow(store, workTreeProvider, glossaryTreeProvider, work.id);
        return;
      case "openChapter": {
        const chapter = work.chapters.find((candidate) => candidate.id === message.chapterId);
        if (chapter) {
          await openCompareView(store, compareView, chapter);
        }
        return;
      }
    }
  }

  private async getSelectedWork(): Promise<WorkConfig | undefined> {
    const config = await this.deps.store.load();
    return config.works.find((work) => work.id === this.selectedWorkId);
  }

  private async postState(): Promise<void> {
    const config = await this.deps.store.load();
    if (!config.works.some((work) => work.id === this.selectedWorkId)) {
      this.selectedWorkId = config.works[0]?.id;
    }
    void this.panel.webview.postMessage({
      type: "state",
      selectedWorkId: this.selectedWorkId,
      works: config.works.map((work) => ({
        id: work.id,
        title: work.title,
        author: work.author,
        sourceLanguage: work.sourceLanguage,
        targetLanguage: work.targetLanguage,
        isEpub: Boolean(work.epubSource),
        glossaryCount: work.glossary.length,
        chapters: work.chapters.map((chapter) => ({ id: chapter.id, title: chapter.title }))
      }))
    });
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
<title>作品管理</title>
<style>
  [hidden] { display: none !important; }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    padding: 0;
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    background-color: var(--vscode-editor-background);
  }
  button {
    background-color: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    padding: 4px 10px;
    cursor: pointer;
    font: inherit;
  }
  button:hover { background-color: var(--vscode-button-hoverBackground); }
  button.secondary {
    background-color: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  button.secondary:hover { background-color: var(--vscode-button-secondaryHoverBackground); }
  button:focus-visible, input:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: 1px;
  }
  .layout { display: flex; height: 100%; min-height: 0; }
  .sidebar {
    display: flex;
    flex: 0 0 280px;
    flex-direction: column;
    min-height: 0;
    border-right: 1px solid var(--vscode-panel-border);
  }
  .sidebar-header {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  .sidebar-actions { display: flex; gap: 6px; }
  .sidebar-actions button { flex: 1 1 0; }
  #searchInput {
    width: 100%;
    background-color: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    padding: 4px 8px;
    font: inherit;
  }
  #workList { flex: 1 1 auto; margin: 0; padding: 0; overflow-y: auto; list-style: none; }
  .work-button {
    display: block;
    width: 100%;
    padding: 8px 12px;
    color: var(--vscode-foreground);
    background: transparent;
    text-align: left;
  }
  .work-button:hover { background-color: var(--vscode-list-hoverBackground); }
  .work-button[aria-current="true"] {
    color: var(--vscode-list-activeSelectionForeground);
    background-color: var(--vscode-list-activeSelectionBackground);
  }
  .work-title, .work-meta { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .work-meta { margin-top: 2px; font-size: 0.9em; opacity: 0.75; }
  .detail { flex: 1 1 auto; min-width: 0; overflow-y: auto; padding: 20px 24px; }
  .detail-header { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 12px; }
  h1 { margin: 0; font-size: 1.5em; font-weight: 600; overflow-wrap: anywhere; }
  h2 { margin: 24px 0 8px; font-size: 1.1em; font-weight: 600; }
  .subtitle { margin-top: 4px; color: var(--vscode-descriptionForeground); }
  .actions { display: flex; flex-wrap: wrap; gap: 6px; }
  .facts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 12px;
    margin: 20px 0 0;
    padding: 12px 0;
    border-top: 1px solid var(--vscode-panel-border);
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  .facts dt { font-size: 0.9em; color: var(--vscode-descriptionForeground); }
  .facts dd { margin: 2px 0 0; overflow-wrap: anywhere; }
  .section-header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin-top: 16px; }
  .section-header h2 { margin: 8px 0; }
  #chapterList { margin: 0; padding: 0; list-style: none; }
  #chapterList li {
    display: flex;
    align-items: center;
    gap: 4px;
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  .chapter-actions { display: flex; flex: 0 0 auto; gap: 4px; }
  .chapter-input { flex: 1 1 auto; min-width: 0; margin: 3px 0; }
  .text-input {
    width: 100%;
    background-color: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    padding: 4px 8px;
    font: inherit;
  }
  #workForm {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
    margin-top: 20px;
    padding: 12px 0;
    border-top: 1px solid var(--vscode-panel-border);
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  #workForm label { display: flex; flex-direction: column; gap: 4px; font-size: 0.9em; color: var(--vscode-descriptionForeground); }
  #workForm .form-actions { display: flex; grid-column: 1 / -1; gap: 6px; }
  .chapter-button {
    display: flex;
    flex: 1 1 auto;
    min-width: 0;
    gap: 12px;
    padding: 7px 4px;
    color: var(--vscode-foreground);
    background: transparent;
    text-align: left;
  }
  .chapter-button:hover { background-color: var(--vscode-list-hoverBackground); }
  .chapter-number { flex: 0 0 3em; color: var(--vscode-descriptionForeground); font-variant-numeric: tabular-nums; }
  .chapter-title { min-width: 0; overflow-wrap: anywhere; }
  .empty { padding: 16px 12px; color: var(--vscode-descriptionForeground); }
  @media (max-width: 640px) {
    .layout { display: block; height: auto; }
    .sidebar { border-right: none; border-bottom: 1px solid var(--vscode-panel-border); }
    #workList { max-height: 200px; }
    .detail { padding: 16px; }
  }
</style>
</head>
<body>
  <div class="layout">
    <aside class="sidebar" aria-label="作品清單">
      <div class="sidebar-header">
        <div class="sidebar-actions">
          <button id="addWorkButton">新增作品</button>
          <button id="importEpubButton" class="secondary">匯入 EPUB</button>
        </div>
        <input id="searchInput" type="text" placeholder="搜尋作品或作者..." aria-label="搜尋作品或作者" />
      </div>
      <ul id="workList"></ul>
      <div id="workEmpty" class="empty" hidden></div>
    </aside>
    <main class="detail">
      <div id="noSelection" class="empty" hidden>尚未建立作品。按「新增作品」或「匯入 EPUB」開始。</div>
      <div id="workDetail" hidden>
        <div class="detail-header">
          <div>
            <h1 id="detailTitle"></h1>
            <div id="detailAuthor" class="subtitle"></div>
          </div>
          <div class="actions">
            <button data-action="editWork" class="secondary">編輯資料</button>
            <button data-action="openGlossary" class="secondary">詞彙管理</button>
            <button id="exportEpubButton" data-action="exportEpub" class="secondary">匯出 EPUB</button>
          </div>
        </div>
        <form id="workForm" hidden>
          <label>作品名稱<input id="formTitle" class="text-input" type="text" required /></label>
          <label>作者<input id="formAuthor" class="text-input" type="text" /></label>
          <label>原文語言<input id="formSource" class="text-input" type="text" placeholder="例如 ja、en" /></label>
          <label>譯文語言<input id="formTarget" class="text-input" type="text" placeholder="例如 zh-TW" /></label>
          <div class="form-actions">
            <button type="submit">儲存</button>
            <button id="cancelWorkEdit" type="button" class="secondary">取消</button>
          </div>
        </form>
        <dl id="workFacts" class="facts">
          <div><dt>原文語言</dt><dd id="factSource"></dd></div>
          <div><dt>譯文語言</dt><dd id="factTarget"></dd></div>
          <div><dt>章節</dt><dd id="factChapters"></dd></div>
          <div><dt>詞條</dt><dd id="factGlossary"></dd></div>
          <div><dt>來源</dt><dd id="factOrigin"></dd></div>
        </dl>
        <div class="section-header">
          <h2>章節</h2>
          <div class="actions">
            <button data-action="addChapter">新增章節</button>
            <button data-action="importChapterFile" class="secondary">匯入文字檔</button>
          </div>
        </div>
        <ol id="chapterList"></ol>
        <div id="chapterEmpty" class="empty" hidden>這個作品還沒有章節。</div>
      </div>
    </main>
  </div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const byId = (id) => document.getElementById(id);
  const searchInput = byId("searchInput");
  const workList = byId("workList");
  const chapterList = byId("chapterList");
  let works = [];
  let selectedWorkId;
  let editingWork = false;
  let editingChapterId;
  let chapterDraft = "";

  function setWorkEditing(editing) {
    editingWork = editing;
    byId("workForm").hidden = !editing;
    byId("workFacts").hidden = editing;
  }

  function openWorkForm() {
    const work = works.find((candidate) => candidate.id === selectedWorkId);
    if (!work) {
      return;
    }
    byId("formTitle").value = work.title;
    byId("formAuthor").value = work.author || "";
    byId("formSource").value = work.sourceLanguage || "";
    byId("formTarget").value = work.targetLanguage || "";
    setWorkEditing(true);
    byId("formTitle").focus();
  }

  byId("workForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const title = byId("formTitle").value.trim();
    if (!title) {
      byId("formTitle").focus();
      return;
    }
    vscode.postMessage({
      type: "saveWork",
      title,
      author: byId("formAuthor").value,
      sourceLanguage: byId("formSource").value,
      targetLanguage: byId("formTarget").value
    });
    setWorkEditing(false);
  });
  byId("cancelWorkEdit").addEventListener("click", () => setWorkEditing(false));

  function startChapterEdit(chapter) {
    editingChapterId = chapter.id;
    chapterDraft = chapter.title;
    renderDetail();
    const input = chapterList.querySelector("input");
    input.focus();
    input.select();
  }

  function stopChapterEdit() {
    editingChapterId = undefined;
    renderDetail();
  }

  function commitChapterEdit() {
    const title = chapterDraft.trim();
    if (!title) {
      return;
    }
    vscode.postMessage({ type: "renameChapter", chapterId: editingChapterId, title });
    stopChapterEdit();
  }

  function renderChapterEditor(item) {
    const input = document.createElement("input");
    input.className = "text-input chapter-input";
    input.type = "text";
    input.value = chapterDraft;
    input.setAttribute("aria-label", "章節標題");
    input.addEventListener("input", () => { chapterDraft = input.value; });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commitChapterEdit();
      } else if (event.key === "Escape") {
        stopChapterEdit();
      }
    });
    item.appendChild(input);

    const actions = document.createElement("div");
    actions.className = "chapter-actions";
    const save = document.createElement("button");
    save.textContent = "儲存";
    save.addEventListener("click", commitChapterEdit);
    const cancel = document.createElement("button");
    cancel.className = "secondary";
    cancel.textContent = "取消";
    cancel.addEventListener("click", stopChapterEdit);
    actions.append(save, cancel);
    item.appendChild(actions);
  }

  byId("addWorkButton").addEventListener("click", () => vscode.postMessage({ type: "addWork" }));
  byId("importEpubButton").addEventListener("click", () => vscode.postMessage({ type: "importEpub" }));
  searchInput.addEventListener("input", renderWorkList);

  byId("workDetail").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }
    if (button.dataset.action === "editWork") {
      openWorkForm();
    } else {
      vscode.postMessage({ type: button.dataset.action });
    }
  });

  workList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-work-id]");
    if (button) {
      vscode.postMessage({ type: "selectWork", workId: button.dataset.workId });
    }
  });

  chapterList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-chapter-id]");
    if (button) {
      vscode.postMessage({ type: "openChapter", chapterId: button.dataset.chapterId });
    }
  });

  function appendSpan(parent, className, text) {
    const span = document.createElement("span");
    span.className = className;
    span.textContent = text;
    parent.appendChild(span);
  }

  function renderWorkList() {
    const query = searchInput.value.trim().toLowerCase();
    const visible = works.filter((work) =>
      !query || work.title.toLowerCase().includes(query) || (work.author || "").toLowerCase().includes(query)
    );

    workList.replaceChildren();
    for (const work of visible) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.className = "work-button";
      button.dataset.workId = work.id;
      button.setAttribute("aria-current", String(work.id === selectedWorkId));
      appendSpan(button, "work-title", work.title);
      appendSpan(button, "work-meta", (work.author ? work.author + " · " : "") + work.chapters.length + " 章");
      item.appendChild(button);
      workList.appendChild(item);
    }

    const workEmpty = byId("workEmpty");
    workEmpty.hidden = visible.length > 0;
    workEmpty.textContent = query ? "沒有符合的作品。" : "目前沒有作品。";
  }

  function renderDetail() {
    const work = works.find((candidate) => candidate.id === selectedWorkId);
    byId("noSelection").hidden = Boolean(work);
    byId("workDetail").hidden = !work;
    if (!work) {
      return;
    }

    byId("detailTitle").textContent = work.title;
    byId("detailAuthor").textContent = work.author || "未填寫作者";
    byId("factSource").textContent = work.sourceLanguage || "未設定";
    byId("factTarget").textContent = work.targetLanguage || "未設定";
    byId("factChapters").textContent = work.chapters.length + " 章";
    byId("factGlossary").textContent = work.glossaryCount + " 條";
    byId("factOrigin").textContent = work.isEpub ? "EPUB 匯入" : "手動建立";
    byId("exportEpubButton").hidden = !work.isEpub;

    chapterList.replaceChildren();
    work.chapters.forEach((chapter, index) => {
      const item = document.createElement("li");
      if (chapter.id === editingChapterId) {
        renderChapterEditor(item);
        chapterList.appendChild(item);
        return;
      }

      const button = document.createElement("button");
      button.className = "chapter-button";
      button.dataset.chapterId = chapter.id;
      button.title = "開啟原文／譯文比對";
      appendSpan(button, "chapter-number", String(index + 1));
      appendSpan(button, "chapter-title", chapter.title);
      item.appendChild(button);

      const actions = document.createElement("div");
      actions.className = "chapter-actions";
      const rename = document.createElement("button");
      rename.className = "secondary";
      rename.textContent = "重新命名";
      rename.setAttribute("aria-label", "重新命名「" + chapter.title + "」");
      rename.addEventListener("click", () => startChapterEdit(chapter));
      actions.appendChild(rename);
      item.appendChild(actions);
      chapterList.appendChild(item);
    });
    byId("chapterEmpty").hidden = work.chapters.length > 0;
  }

  window.addEventListener("message", (event) => {
    if (event.data.type === "state") {
      // 切換到別的作品時放棄編輯中的內容；同一作品的背景同步則保留使用者正在輸入的草稿。
      if (event.data.selectedWorkId !== selectedWorkId) {
        setWorkEditing(false);
        editingChapterId = undefined;
      }
      const wasEditingChapter = document.activeElement?.classList.contains("chapter-input");
      works = event.data.works;
      selectedWorkId = event.data.selectedWorkId;
      renderWorkList();
      renderDetail();
      if (wasEditingChapter) {
        chapterList.querySelector("input")?.focus();
      }
    }
  });

  vscode.postMessage({ type: "ready" });
</script>
</body>
</html>`;
  }
}
