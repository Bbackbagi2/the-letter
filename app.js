// 화면과 입력 처리. 배치 계산은 layout.js, 편집 상태는 editor.js, 그리기는 paper.js.

import { ROWS, cursorPositions, indexAt, overflowCount } from "./layout.js";
import { Doc } from "./editor.js";
import * as paper from "./paper.js";
import { FONTS, DEFAULT_FONT } from "./fonts.js";

const INK = "#222222";
const PREEDIT_INK = "#B4B4B4";
const CARET_FILL = "rgba(80,140,255,0.24)";
const SELECTION_FILL = "rgba(80,140,255,0.43)";
const STORE_KEY = "the-letter";

const $ = (id) => document.getElementById(id);
const svg = $("paper");
const ime = $("ime");
const statusBar = $("status");

const state = {
  doc: new Doc(""),
  preedit: "",
  vertical: false,
  ratio: paper.TEXT_RATIO,
  font: DEFAULT_FONT,
  printing: false,
};
const loadedFonts = new Set();
let statusNote = "";

// --- 그리기 ---

function render() {
  const { doc, preedit, vertical, printing } = state;
  // 조합 중인 글자를 커서 자리에 끼워 넣은 상태로 배치를 계산한다
  const shown = doc.text.slice(0, doc.caret) + preedit + doc.text.slice(doc.caret);
  const positions = cursorPositions(shown);
  const rotated = vertical && !printing;

  svg.setAttribute("viewBox", rotated ? `0 0 ${paper.PAGE_H} ${paper.PAGE_W}`
    : `0 0 ${paper.PAGE_W} ${paper.PAGE_H}`);
  const inner = paper.pageSVG(shown, {
    family: state.font, ratio: state.ratio, vertical, ink: INK, preeditInk: PREEDIT_INK,
    positions, caret: doc.caret, selection: preedit ? null : doc.selection(),
    preeditRange: preedit ? [doc.caret, doc.caret + preedit.length] : null,
    caretFill: CARET_FILL, selectionFill: SELECTION_FILL,
  });
  // 세로 모드 화면: 종이를 시계 방향 90° 돌려 보여 준다 (1줄이 오른쪽 끝 열)
  svg.innerHTML = rotated
    ? `<g id="content" transform="translate(${paper.PAGE_H} 0) rotate(90)">${inner}</g>`
    : `<g id="content">${inner}</g>`;

  placeIme(positions[doc.caret]);
  showStatus();
  save();
}

function showStatus() {
  const over = overflowCount(state.doc.text);
  const parts = [];
  if (statusNote) parts.push(statusNote);
  if (over) parts.push(`${ROWS}줄을 넘은 글자 ${over}자는 표시되지 않습니다`);
  statusBar.textContent = parts.join(" · ") || " ";
}

function note(text) {
  statusNote = text;
  showStatus();
}

/** 보이지 않는 입력칸을 커서 칸 위로 옮긴다. 한글 조합 후보 창이 그 옆에 뜬다. */
function placeIme([row, col]) {
  const content = svg.querySelector("#content");
  const ctm = content?.getScreenCTM();
  if (!ctm) return;
  const r = paper.cellRect(Math.min(row, ROWS - 1), col);
  const point = svg.createSVGPoint();
  point.x = r.x; point.y = r.y;
  const topLeft = point.matrixTransform(ctm);
  point.x = r.x + r.w; point.y = r.y + r.h;
  const bottomRight = point.matrixTransform(ctm);
  ime.style.left = `${Math.min(topLeft.x, bottomRight.x)}px`;
  ime.style.top = `${Math.min(topLeft.y, bottomRight.y)}px`;
  ime.style.width = `${Math.abs(bottomRight.x - topLeft.x)}px`;
  ime.style.height = `${Math.abs(bottomRight.y - topLeft.y)}px`;
  ime.style.fontSize = `${Math.abs(bottomRight.y - topLeft.y)}px`;
}

// --- 글꼴 ---

async function useFont(label) {
  state.font = label;
  const info = FONTS.find((f) => f.label === label);
  if (info && !loadedFonts.has(label)) {
    note(`글꼴 받는 중… ${label} (${(info.kb / 1024).toFixed(1)}MB)`);
    try {
      const face = new FontFace(label, `url("fonts/${encodeURIComponent(info.file)}")`);
      await face.load();
      document.fonts.add(face);
      loadedFonts.add(label);
      note("");
    } catch (e) {
      note(`글꼴을 받지 못했습니다 (${label}). 기본 글꼴로 보여 줍니다.`);
    }
    paper.clearFontCache();
  }
  render();
}

// --- 저장·불러오기 ---

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        text: state.doc.text, font: state.font, ratio: state.ratio, vertical: state.vertical,
      }));
    } catch (e) { /* 저장 공간이 없으면 그냥 넘어간다 */ }
  }, 400);
}

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    if (typeof saved.text === "string") state.doc = new Doc(saved.text);
    if (typeof saved.ratio === "number") state.ratio = saved.ratio;
    if (typeof saved.vertical === "boolean") state.vertical = saved.vertical;
    if (FONTS.some((f) => f.label === saved.font)) state.font = saved.font;
  } catch (e) { /* 저장된 게 깨졌으면 새로 시작 */ }
}

function downloadText() {
  const blob = new Blob([state.doc.text], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "편지.txt";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  note("편지.txt로 내려받았습니다");
}

function openFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const text = String(reader.result).replace(/^﻿/, "").replace(/\r\n?/g, "\n");
    state.doc = new Doc(text);
    state.preedit = "";
    note(`불러옴: ${file.name}`);
    render();
  };
  reader.onerror = () => note("파일을 읽지 못했습니다");
  reader.readAsText(file, "utf-8");
}

// --- 마우스·터치 ---

/** 화면 좌표 → 종이 mm 좌표 */
function toPaper(event) {
  const content = svg.querySelector("#content");
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  return point.matrixTransform(content.getScreenCTM().inverse());
}

/** boundary=true(드래그·Shift+클릭)면 칸의 뒤쪽 절반을 눌렀을 때 그 글자 뒤로 잡는다. */
function indexAtEvent(event, boundary) {
  const { text } = state.doc;
  const p = toPaper(event);
  const [row, col] = paper.cellAt(p.x, p.y);
  let index = indexAt(text, row, col);
  if (boundary && index < text.length && text[index] !== "\n") {
    const [r, c] = cursorPositions(text)[index];
    if (r === row && c === col && p.x > paper.cellRect(row, col).x + paper.CELL / 2) index += 1;
  }
  return index;
}

let dragging = false;
svg.addEventListener("pointerdown", (e) => {
  // 손가락은 화면을 밀거나 확대하는 데 쓰므로 커서만 옮긴다
  const canDrag = e.pointerType !== "touch";
  if (canDrag) e.preventDefault();
  ime.focus({ preventScroll: true });
  state.doc.moveTo(indexAtEvent(e, e.shiftKey), e.shiftKey);
  if (canDrag) {
    dragging = true;
    svg.setPointerCapture(e.pointerId);
  }
  render();
});
svg.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  state.doc.moveTo(indexAtEvent(e, true), true);
  render();
});
const stopDrag = (e) => {
  if (!dragging) return;
  dragging = false;
  try { svg.releasePointerCapture(e.pointerId); } catch (err) { /* 이미 놓음 */ }
};
svg.addEventListener("pointerup", stopDrag);
svg.addEventListener("pointercancel", stopDrag);

// --- 글자 입력 (조합 포함) ---

ime.addEventListener("compositionupdate", (e) => {
  state.preedit = e.data || "";
  render();
});
ime.addEventListener("compositionend", (e) => {
  state.preedit = "";
  if (e.data) state.doc.insert(e.data);
  ime.value = "";
  render();
});
ime.addEventListener("input", (e) => {
  if (e.isComposing || state.preedit) return;
  if (ime.value) {
    state.doc.insert(ime.value);
    ime.value = "";
    render();
  }
});

const ARROWS = {
  "false,ArrowLeft": ["moveChar", -1], "false,ArrowRight": ["moveChar", 1],
  "false,ArrowUp": ["moveRow", -1], "false,ArrowDown": ["moveRow", 1],
  "true,ArrowUp": ["moveChar", -1], "true,ArrowDown": ["moveChar", 1],
  "true,ArrowRight": ["moveRow", -1], "true,ArrowLeft": ["moveRow", 1],
};

ime.addEventListener("keydown", (e) => {
  if (e.isComposing) return;
  const doc = state.doc;
  const command = e.metaKey || e.ctrlKey;
  const arrow = ARROWS[`${state.vertical},${e.key}`];

  if (command && e.key.toLowerCase() === "z") {
    e.shiftKey ? doc.redo() : doc.undo();
  } else if (command && e.key.toLowerCase() === "y") {
    doc.redo();
  } else if (command && e.key.toLowerCase() === "a") {
    doc.selectAll();
  } else if (command && e.key.toLowerCase() === "s") {
    downloadText();
  } else if (command && e.key === "Backspace") {
    doc.deleteToRowStart();
  } else if (arrow) {
    doc[arrow[0]](arrow[1], e.shiftKey);
  } else if (e.key === "Backspace") {
    doc.backspace();
  } else if (e.key === "Delete") {
    doc.deleteForward();
  } else {
    return; // 글자 입력·복사·붙여넣기는 아래 이벤트에서 처리
  }
  e.preventDefault();
  render();
});

ime.addEventListener("copy", (e) => {
  const sel = state.doc.selectedText();
  if (!sel) return;
  e.clipboardData.setData("text/plain", sel);
  e.preventDefault();
});
ime.addEventListener("cut", (e) => {
  const sel = state.doc.selectedText();
  if (!sel) return;
  e.clipboardData.setData("text/plain", state.doc.cut());
  e.preventDefault();
  render();
});
ime.addEventListener("paste", (e) => {
  const text = e.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n");
  e.preventDefault();
  if (!text) return;
  state.doc.insert(text, "paste");
  render();
});

// --- 도구 모음 ---

$("vertical").addEventListener("click", (e) => {
  state.vertical = !state.vertical;
  e.currentTarget.setAttribute("aria-pressed", String(state.vertical));
  ime.focus({ preventScroll: true });
  render();
});
$("font").addEventListener("change", (e) => useFont(e.target.value));
$("size").addEventListener("input", (e) => {
  state.ratio = Number(e.target.value) / 100;
  $("sizeValue").textContent = `${e.target.value}%`;
  render();
});
$("open").addEventListener("click", () => $("file").click());
$("file").addEventListener("change", (e) => {
  if (e.target.files[0]) openFile(e.target.files[0]);
  e.target.value = "";
});
$("save").addEventListener("click", downloadText);
$("print").addEventListener("click", () => window.print());

// 인쇄할 때는 세로 모드여도 용지를 원래 방향(A4 세로)으로 두고 글자만 눕힌다
addEventListener("beforeprint", () => { state.printing = true; render(); });
addEventListener("afterprint", () => { state.printing = false; render(); });
addEventListener("resize", () => render());

// --- 시작 ---

restore();
for (const f of FONTS) {
  const option = document.createElement("option");
  option.value = f.label;
  option.textContent = `${f.label} (${(f.kb / 1024).toFixed(1)}MB)`;
  $("font").append(option);
}
$("font").value = state.font;
$("size").value = Math.round(state.ratio * 100);
$("sizeValue").textContent = `${Math.round(state.ratio * 100)}%`;
$("vertical").setAttribute("aria-pressed", String(state.vertical));
render();
useFont(state.font);
ime.focus({ preventScroll: true });

if ("serviceWorker" in navigator) {
  addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
