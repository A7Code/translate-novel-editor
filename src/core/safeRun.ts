// 事件監聽或背景自動觸發（非使用者主動呼叫指令）的非同步流程，若直接用 `void` 丟掉
// 而不接 catch，執行中拋出的例外就會變成沒人接住的 rejection。這類流程常常在
// 分頁、文件、workspace 狀態還沒就緒時被觸發（例如 VS Code 還原分頁、設定變更、
// webview 訊息），底層 API 在那種時機拋例外是真的會發生的狀況，不是假設。
// 統一在這裡接住並印出，讓單一子功能失敗時不會波及其他功能，也不會讓未接住的
// rejection 累積而拖垮 Extension Host。
export function safeRun(promise: Promise<unknown>, context: string): void {
  promise.catch((error) => {
    console.error(`[novelTranslate] ${context} 發生未預期的錯誤：`, error);
  });
}
