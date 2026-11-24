// 讓翻譯筆記（討論串）的行號範圍跟著文字變更移動（B7）。這裡不依賴 vscode，
// 純粹處理「某段行號範圍被另一段取代後，一個依行號定位的範圍應該移到哪裡」。

export interface LineRange {
  /** 0-indexed，含。 */
  startLine: number;
  /** 0-indexed，含。 */
  endLine: number;
}

export interface LineChange extends LineRange {
  /** 這段範圍被取代後變成幾行。 */
  newLineCount: number;
}

function lineSpanOf(text: string): number {
  return text.split(/\r\n|\r|\n/).length;
}

/** 從 vscode.TextDocumentContentChangeEvent 的 range 與 text 建立 LineChange，供 shiftLineRange 使用。 */
export function describeTextChange(startLine: number, endLine: number, insertedText: string): LineChange {
  return { startLine, endLine, newLineCount: lineSpanOf(insertedText) };
}

/**
 * 文件被編輯後，重新計算一個依行號定位的範圍（討論串）應該移到哪裡：
 * - 範圍完全在變更之前：不受影響。
 * - 範圍完全在變更之後：依這次變更增減的行數整體平移。
 * - 範圍的某一端落在被取代的行號區段內：收斂到變更的起點，視為跟著被取代的內容一起改寫
 *   （這是已知的簡化：如果使用者真正想做的是「在這個範圍最前面插入新行」而不是「取代這個範圍」，
 *   範圍可能會少往後移一行；比起完全不調整，這仍然大幅改善 B7 的情況）。
 */
export function shiftLineRange(range: LineRange, change: LineChange): LineRange {
  const oldLineCount = change.endLine - change.startLine + 1;
  const delta = change.newLineCount - oldLineCount;

  const shift = (line: number): number => {
    if (line < change.startLine) {
      return line;
    }
    if (line <= change.endLine) {
      return change.startLine;
    }
    return line + delta;
  };

  const startLine = shift(range.startLine);
  const endLine = Math.max(startLine, shift(range.endLine));
  return { startLine, endLine };
}
