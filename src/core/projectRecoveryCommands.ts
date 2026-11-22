import * as vscode from "vscode";
import { ProjectStore } from "./projectStore";

export const RESTORE_PROJECT_COMMAND_ID = "novelTranslate.restoreProjectBackup";

export function notifyProjectLoadFailure(error: Error): void {
  const restoreAction = "從備份還原";
  void vscode.window
    .showErrorMessage(`project.json 無法讀取，已停止寫入以保護資料。（${error.message}）`, restoreAction)
    .then((selection) => {
      if (selection === restoreAction) {
        void vscode.commands.executeCommand(RESTORE_PROJECT_COMMAND_ID);
      }
    });
}

export async function restoreProjectBackup(store: ProjectStore | undefined, onRestored: () => void): Promise<void> {
  if (!store) {
    vscode.window.showErrorMessage("請先開啟一個工作區資料夾。");
    return;
  }
  const backups = await store.listProjectBackups();
  if (backups.length === 0) {
    vscode.window.showWarningMessage("目前沒有可用的 project.json 備份。");
    return;
  }

  const picked = await vscode.window.showQuickPick(backups, { placeHolder: "選擇要還原的備份（最新的在最上面）" });
  if (!picked) {
    return;
  }
  const confirmAction = "還原";
  const answer = await vscode.window.showWarningMessage(
    `要用 ${picked} 取代目前的 project.json 嗎？`,
    { modal: true, detail: "目前的檔案會先另存到 .novel-translate/backups/，檔名以 corrupt-project 開頭。" },
    confirmAction
  );
  if (answer !== confirmAction) {
    return;
  }

  await store.restoreProjectBackup(picked);
  onRestored();
  vscode.window.showInformationMessage(`已從 ${picked} 還原專案。`);
}
