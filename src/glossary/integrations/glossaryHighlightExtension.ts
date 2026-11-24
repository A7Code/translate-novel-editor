import * as vscode from "vscode";
import { ProjectStore } from "../../core/projectStore";
import { safeRun } from "../../core/safeRun";
import { TRANSLATION_LANGUAGE_ID } from "../../core/constants";
import { findGlossaryTermMatches } from "../glossaryHighlight";
import { enabledGlossaryEntries } from "../glossaryCategories";

// 控制是否在原文中把已收錄的詞彙表詞條加底線的設定鍵，預設開啟。
export const GLOSSARY_HIGHLIGHT_ENABLED_SETTING_KEY = "novelTranslate.glossaryHighlight.enabled";

// 用 currentColor（不指定顏色）而不是自訂色，跟著編輯器文字顏色走，深淺色主題都不需要額外處理。
const DECORATION_TYPE = vscode.window.createTextEditorDecorationType({
  textDecoration: "underline"
});

/**
 * 在原文裡把已收錄的詞彙表詞條加底線（1.5），只標示「原文」那一側——跟
 * GlossaryCompletionProvider（自動完成，只在譯文側有意義）互補。原文是唯讀文字，
 * 內容不會因為編輯而改變，所以只需要在「可見編輯器變化」「詞彙表資料變化」時
 * 重新計算，不需要像行數對齊檢查那樣對每次按鍵做 debounce。
 */
export class GlossaryHighlightExtension implements vscode.Disposable {
  private readonly configSubscription: vscode.Disposable;
  private registrations: vscode.Disposable[] = [];

  constructor(
    private readonly store: ProjectStore | undefined,
    glossaryChangeEvent: vscode.Event<void>
  ) {
    this.configSubscription = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(GLOSSARY_HIGHLIGHT_ENABLED_SETTING_KEY)) {
        this.applyEnabledSetting(glossaryChangeEvent);
      }
    });
    this.applyEnabledSetting(glossaryChangeEvent);
  }

  dispose(): void {
    this.configSubscription.dispose();
    this.deactivate();
    DECORATION_TYPE.dispose();
  }

  private applyEnabledSetting(glossaryChangeEvent: vscode.Event<void>): void {
    const enabled = vscode.workspace.getConfiguration().get<boolean>(GLOSSARY_HIGHLIGHT_ENABLED_SETTING_KEY, true);
    if (enabled) {
      this.activate(glossaryChangeEvent);
    } else {
      this.deactivate();
    }
  }

  private activate(glossaryChangeEvent: vscode.Event<void>): void {
    if (this.registrations.length > 0) {
      return;
    }
    const refresh = () => safeRun(this.refresh(), "標示原文詞彙");
    this.registrations = [
      vscode.window.onDidChangeVisibleTextEditors(refresh),
      glossaryChangeEvent(refresh)
    ];
    refresh();
  }

  private deactivate(): void {
    for (const registration of this.registrations) {
      registration.dispose();
    }
    this.registrations = [];
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(DECORATION_TYPE, []);
    }
  }

  private async refresh(): Promise<void> {
    if (!this.store) {
      return;
    }
    const editors = vscode.window.visibleTextEditors.filter(
      (editor) => editor.document.languageId === TRANSLATION_LANGUAGE_ID
    );
    await Promise.all(editors.map((editor) => this.decorateEditor(editor)));
  }

  private async decorateEditor(editor: vscode.TextEditor): Promise<void> {
    const found = this.store && (await this.store.findChapterForDocumentUri(editor.document.uri));
    if (!found || found.relativePath !== found.chapter.originalPath) {
      editor.setDecorations(DECORATION_TYPE, []);
      return;
    }

    const config = await this.store!.load();
    const work = config.works.find((candidate) => candidate.id === found.workId);
    const glossary = work ? enabledGlossaryEntries(work) : [];
    if (glossary.length === 0) {
      editor.setDecorations(DECORATION_TYPE, []);
      return;
    }

    const ranges: vscode.Range[] = [];
    const document = editor.document;
    for (let line = 0; line < document.lineCount; line++) {
      const lineText = document.lineAt(line).text;
      for (const match of findGlossaryTermMatches(lineText, glossary)) {
        ranges.push(new vscode.Range(line, match.start, line, match.start + match.length));
      }
    }
    editor.setDecorations(DECORATION_TYPE, ranges);
  }
}
