// 원문 문자열 → 원고지 (줄, 칸) 배치 계산. 데스크톱 앱 layout.py와 같은 규칙.
// 인덱스는 JavaScript 문자열 그대로(UTF-16 단위)여서 slice·length와 바로 맞는다.
// 이모지처럼 두 단위로 된 글자는 두 인덱스가 같은 칸을 가리키고 한 칸만 차지한다.

export const COLS = 20;
export const ROWS = 30;

/** text의 각 인덱스(0 ~ text.length)에 대응하는 [줄, 칸]. 마지막 항목은 글 끝(커서 자리). */
export function cursorPositions(text) {
  let row = 0, col = 0;
  const positions = [];
  for (let i = 0; i < text.length; i++) {
    positions.push([row, col]);
    const pair = text.codePointAt(i) > 0xffff;
    if (pair) {
      positions.push([row, col]); // 뒤쪽 단위도 같은 칸
      i += 1;
    }
    if (!pair && text[i] === "\n") {
      row += 1;
      col = 0;
    } else if (++col === COLS) {
      row += 1;
      col = 0;
    }
  }
  positions.push([row, col]);
  return positions;
}

/** 원고지에 그릴 칸 목록 {row, col, char, index}. 30줄을 넘는 글자는 뺀다. */
export function cells(text) {
  const positions = cursorPositions(text);
  const out = [];
  for (let i = 0; i < text.length; i++) {
    const ch = String.fromCodePoint(text.codePointAt(i));
    const [row, col] = positions[i];
    if (ch !== "\n" && row < ROWS) out.push({ row, col, char: ch, index: i });
    i += ch.length - 1;
  }
  return out;
}

/** 30줄을 넘어가서 표시하지 못하는 글자 수. */
export function overflowCount(text) {
  const positions = cursorPositions(text);
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = String.fromCodePoint(text.codePointAt(i));
    if (ch !== "\n" && positions[i][0] >= ROWS) n += 1;
    i += ch.length - 1;
  }
  return n;
}

/** (줄, 칸)에 해당하는 커서 인덱스. 줄이 짧으면 줄 끝, 글보다 아래면 글 끝, 음수 줄이면 글 처음. */
export function indexAt(text, row, col) {
  if (row < 0) return 0;
  const positions = cursorPositions(text);
  let best = null;
  for (let i = 0; i < positions.length; i++) {
    const [r, c] = positions[i];
    if (r === row) {
      if (best === null) best = i;
      if (c >= col) return i;
      best = i;
    } else if (r > row) break;
  }
  return best === null ? text.length : best;
}
