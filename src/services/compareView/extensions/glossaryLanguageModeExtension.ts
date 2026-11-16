import * as vscode from "vscode";
import { CompareView } from "../compareView";
import { GLOSSARY_AUTOCOMPLETE_ENABLED_SETTING_KEY, TRANSLATION_LANGUAGE_ID } from "../../../constants";
import { safeRun } from "../../safeRun";

// 開啟比對畫面時，是否自動把原文／譯文兩側的分頁切換為詞彙表自動完成語言模式。
// 只有在設定開啟時才向 CompareView 註冊監聽；設定關閉就取消訂閱。
export class GlossaryLanguageModeExtension implements vscode.Disposable {
  private readonly configSubscription: vscode.Disposable;
  private registration: vscode.Disposable | undefined;

  constructor(private readonly compareView: CompareView) {
    this.configSubscription = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(GLOSSARY_AUTOCOMPLETE_ENABLED_SETTING_KEY)) {
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
    const enabled = vscode.workspace
      .getConfiguration()
      .get<boolean>(GLOSSARY_AUTOCOMPLETE_ENABLED_SETTING_KEY, true);
    if (enabled) {
      this.activate();
    } else {
      this.deactivate();
    }
  }

  private activate(): void {
    if (this.registration) {
      return;
    }
    this.registration = this.compareView.onDidSetPair((pair) => {
      safeRun(this.applyLanguageMode(pair.originalUri), "切換原文分頁語言模式");
      safeRun(this.applyLanguageMode(pair.translationUri), "切換譯文分頁語言模式");
    });
  }

  private deactivate(): void {
    this.registration?.dispose();
    this.registration = undefined;
  }

  private async applyLanguageMode(uri: vscode.Uri): Promise<void> {
    const document = vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === uri.toString());
    if (!document || document.languageId === TRANSLATION_LANGUAGE_ID) {
      return;
    }
    await vscode.languages.setTextDocumentLanguage(document, TRANSLATION_LANGUAGE_ID);
  }
}
