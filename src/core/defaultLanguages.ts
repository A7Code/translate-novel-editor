import * as vscode from "vscode";
import { DEFAULT_SOURCE_LANGUAGE_SETTING_KEY, DEFAULT_TARGET_LANGUAGE_SETTING_KEY } from "./constants";

// 回傳使用者設定的預設語言；沒設定或只有空白時為 undefined，代表不預先填入。
export function getDefaultLanguages(): { source?: string; target?: string } {
  const config = vscode.workspace.getConfiguration();
  return {
    source: config.get<string>(DEFAULT_SOURCE_LANGUAGE_SETTING_KEY, "").trim() || undefined,
    target: config.get<string>(DEFAULT_TARGET_LANGUAGE_SETTING_KEY, "").trim() || undefined
  };
}
