import * as vscode from "vscode";
import { safeRun } from "../../core/safeRun";
import { ProjectStore } from "../../core/projectStore";
import { CompareEditorPair, CompareView } from "../../compareView/compareView";
import { consistencyIssueKey, findConsistencyIssues } from "../consistencyCheck";
import { enabledGlossaryEntries } from "../glossaryCategories";

// 控制是否在 Problems 面板提示譯名一致性問題（1.7）的設定鍵，預設開啟。
export const GLOSSARY_CONSISTENCY_CHECK_ENABLED_SETTING_KEY = "novelTranslate.glossaryConsistencyCheck.enabled";
// 快速修正「忽略這個提示」對應的指令 id，由 extension.ts 註冊、ConsistencyIssueCodeActionProvider 呼叫。
export const IGNORE_CONSISTENCY_ISSUE_COMMAND_ID = "novelTranslate.ignoreConsistencyIssue";

const DEBOUNCE_MS = 300;
const DIAGNOSTIC_SOURCE = "novelTranslate";

/**
 * 跟 LineAlignmentDiagnosticsExtension 是同樣的「掛在 CompareView 上」結構：只檢查目前開著的
 * 比對配對，設定關閉時完全不註冊監聽、不留下任何診斷。偵測邏輯本身在 glossary/consistencyCheck.ts，
 * 這裡只負責決定何時重新檢查、讀取目前章節的詞彙表與忽略清單，並把結果轉成 vscode.Diagnostic。
 * 診斷的 code 欄位存詞條 id（字串），忽略清單的 key 則由 (document.uri, diagnostic.range.start.line)
 * 推回對應的作品／章節，讓 ConsistencyIssueCodeActionProvider 不需要依賴物件參照是否跨行程保留。
 */
export class GlossaryConsistencyDiagnosticsExtension implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection("novelTranslate.glossaryConsistency");
  private readonly configSubscription: vscode.Disposable;
  private registrations: vscode.Disposable[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly store: ProjectStore | undefined,
    private readonly compareView: CompareView,
    private readonly glossaryChangeEvent: vscode.Event<void>
  ) {
    this.configSubscription = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(GLOSSARY_CONSISTENCY_CHECK_ENABLED_SETTING_KEY)) {
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

  /** 忽略清單寫入後（不是文件編輯，不會觸發 onDidChangeTextDocument）由呼叫端主動要求重新檢查。 */
  recheck(): void {
    this.scheduleCheck();
  }

  private applyEnabledSetting(): void {
    const enabled = vscode.workspace
      .getConfiguration()
      .get<boolean>(GLOSSARY_CONSISTENCY_CHECK_ENABLED_SETTING_KEY, true);
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
      }),
      this.glossaryChangeEvent(() => this.scheduleCheck())
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
      safeRun(this.check(), "檢查譯名一致性");
    }, DEBOUNCE_MS);
  }

  private async check(): Promise<void> {
    const pair = this.compareView.currentPair;
    if (!pair || !this.store) {
      this.collection.clear();
      return;
    }

    const found = await this.store.findChapterForDocumentUri(pair.translationUri);
    if (!found) {
      this.collection.clear();
      return;
    }

    const [config, originalDocument, translationDocument] = await Promise.all([
      this.store.load(),
      vscode.workspace.openTextDocument(pair.originalUri),
      vscode.workspace.openTextDocument(pair.translationUri)
    ]);
    // 這段 await 期間使用者可能已經切換到別的配對，不能用舊配對算出來的結果覆蓋現況。
    if (!this.isSamePair(this.compareView.currentPair, pair)) {
      return;
    }

    const work = config.works.find((candidate) => candidate.id === found.workId);
    const glossary = work ? enabledGlossaryEntries(work) : [];
    const ignored = new Set(
      (found.chapter.ignoredConsistencyIssues ?? []).map((key) => consistencyIssueKey(key.line, key.entryId))
    );
    const issues = findConsistencyIssues(originalDocument.getText(), translationDocument.getText(), glossary, ignored);

    const diagnostics = issues.map((issue) => {
      const diagnostic = new vscode.Diagnostic(
        translationDocument.lineAt(issue.line).range,
        issue.message,
        vscode.DiagnosticSeverity.Information
      );
      diagnostic.source = DIAGNOSTIC_SOURCE;
      diagnostic.code = issue.entryId;
      return diagnostic;
    });
    // 只保留目前這對配對的診斷，切換章節後舊章節的提示不會留著。
    this.collection.clear();
    this.collection.set(translationDocument.uri, diagnostics);
  }

  private isSamePair(a: CompareEditorPair | undefined, b: CompareEditorPair): boolean {
    return (
      !!a && a.originalUri.toString() === b.originalUri.toString() && a.translationUri.toString() === b.translationUri.toString()
    );
  }
}

/** 在譯名一致性提示上提供「忽略這個提示」快速修正，點選後交給 IGNORE_CONSISTENCY_ISSUE_COMMAND_ID 處理實際寫入。 */
export class ConsistencyIssueCodeActionProvider implements vscode.CodeActionProvider {
  static readonly metadata: vscode.CodeActionProviderMetadata = {
    providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
  };

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    for (const diagnostic of context.diagnostics) {
      if (diagnostic.source !== DIAGNOSTIC_SOURCE || typeof diagnostic.code !== "string") {
        continue;
      }
      const action = new vscode.CodeAction("小說翻譯：忽略這個譯名一致性提示", vscode.CodeActionKind.QuickFix);
      action.diagnostics = [diagnostic];
      action.command = {
        command: IGNORE_CONSISTENCY_ISSUE_COMMAND_ID,
        title: "忽略這個譯名一致性提示",
        arguments: [document.uri, diagnostic.range.start.line, diagnostic.code]
      };
      actions.push(action);
    }
    return actions;
  }
}

/** novelTranslate.ignoreConsistencyIssue 指令的實際處理：把 (line, entryId) 記錄到該章節的忽略清單。 */
export async function ignoreConsistencyIssue(
  store: ProjectStore | undefined,
  extension: GlossaryConsistencyDiagnosticsExtension,
  uri: vscode.Uri,
  line: number,
  entryId: string
): Promise<void> {
  if (!store) {
    return;
  }
  const found = await store.findChapterForDocumentUri(uri);
  if (!found) {
    return;
  }
  await store.setConsistencyIssueIgnored(found.workId, found.chapter.id, line, entryId, true);
  extension.recheck();
}
