// 편집 상태: 원문, 커서, 선택, 실행 취소. 데스크톱 앱 editor.py와 같은 규칙.

import { cursorPositions, indexAt } from "./layout.js";

// 같은 종류가 이어지면 실행 취소 한 번에 함께 되돌린다 (연속 타이핑 등)
const COALESCE_KINDS = new Set(["type", "backspace", "delete"]);

export class Doc {
  constructor(text = "") {
    this.text = text;
    this.caret = 0;
    this.anchor = null; // 선택 시작점. null이거나 caret과 같으면 선택 없음
    this.undoStack = [];
    this.redoStack = [];
    this.lastKind = null;
  }

  // --- 선택 ---

  selection() {
    if (this.anchor === null || this.anchor === this.caret) return null;
    return [Math.min(this.anchor, this.caret), Math.max(this.anchor, this.caret)];
  }

  selectedText() {
    const sel = this.selection();
    return sel ? this.text.slice(sel[0], sel[1]) : "";
  }

  selectAll() {
    this.anchor = 0;
    this.caret = this.text.length;
    this.lastKind = null;
  }

  // --- 커서 이동 ---

  moveTo(index, extend = false) {
    if (extend) {
      if (this.anchor === null) this.anchor = this.caret;
    } else {
      this.anchor = null;
    }
    this.caret = Math.min(Math.max(index, 0), this.text.length);
    this.lastKind = null;
  }

  /** 같은 줄 방향으로 한 칸 (step=-1 앞, +1 뒤). 가로 모드 ←→, 세로 모드 ↑↓. */
  moveChar(step, extend = false) {
    const sel = this.selection();
    if (sel && !extend) this.moveTo(step < 0 ? sel[0] : sel[1]);
    else this.moveTo(this.caret + step, extend);
  }

  /** 같은 칸 번호로 이전/다음 줄. 가로 모드 ↑↓, 세로 모드 →←. */
  moveRow(step, extend = false) {
    const sel = this.selection();
    let base = this.caret;
    if (sel && !extend) base = step < 0 ? sel[0] : sel[1];
    const [row, col] = cursorPositions(this.text)[base];
    this.moveTo(indexAt(this.text, row + step, col), extend);
  }

  // --- 편집 ---

  replace(start, end, s, kind) {
    if (!(COALESCE_KINDS.has(kind) && kind === this.lastKind)) {
      this.undoStack.push([this.text, this.caret]);
    }
    this.redoStack.length = 0;
    this.lastKind = kind;
    this.text = this.text.slice(0, start) + s + this.text.slice(end);
    this.caret = start + s.length;
    this.anchor = null;
  }

  deleteSelection(kind) {
    const sel = this.selection();
    if (!sel) return;
    this.lastKind = null; // 선택 삭제는 항상 새 실행 취소 단계로 시작
    this.replace(sel[0], sel[1], "", kind);
  }

  /** 선택이 있으면 선택 부분을 s로 바꾼다. */
  insert(s, kind = "type") {
    const sel = this.selection();
    if (sel) {
      this.lastKind = null;
      this.replace(sel[0], sel[1], s, kind);
    } else {
      this.replace(this.caret, this.caret, s, kind);
    }
  }

  backspace() {
    if (this.selection()) this.deleteSelection("backspace");
    else if (this.caret > 0) this.replace(this.caret - 1, this.caret, "", "backspace");
  }

  deleteForward() {
    if (this.selection()) this.deleteSelection("delete");
    else if (this.caret < this.text.length) this.replace(this.caret, this.caret + 1, "", "delete");
  }

  /** 원고지에서 커서가 있는 줄의 첫 칸까지 지운다. 이미 첫 칸이면 한 글자 지운다. */
  deleteToRowStart() {
    if (this.selection()) {
      this.deleteSelection("row");
      return;
    }
    const [row] = cursorPositions(this.text)[this.caret];
    const start = indexAt(this.text, row, 0);
    if (start === this.caret) this.backspace();
    else this.replace(start, this.caret, "", "row");
  }

  cut() {
    const s = this.selectedText();
    this.deleteSelection("cut");
    return s;
  }

  // --- 실행 취소 ---

  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push([this.text, this.caret]);
    [this.text, this.caret] = this.undoStack.pop();
    this.anchor = null;
    this.lastKind = null;
  }

  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push([this.text, this.caret]);
    [this.text, this.caret] = this.redoStack.pop();
    this.anchor = null;
    this.lastKind = null;
  }
}
