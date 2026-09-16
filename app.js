// 화면과 입력 처리. 배치 계산은 layout.js, 편집 상태는 editor.js, 그리기는 paper.js.

import { ROWS, cursorPositions, indexAt, overflowCount } from "./layout.js";
import { Doc } from "./editor.js";
import * as paper from "./paper.js";
import { FONTS, DEFAULT_FONT } from "./fonts.js";
import { SAMPLE_TEXT } from "./sample.js";

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
  selectMode: false, // 켜면 손가락으로 끌어서 글자를 선택한다 (폰)
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
    const before = statusNote; // 글꼴을 받고 나면 원래 안내 문구로 되돌린다
    note(`글꼴 받는 중… ${label} (${(info.kb / 1024).toFixed(1)}MB)`);
    try {
      const face = new FontFace(label, `url("fonts/${encodeURIComponent(info.file)}")`);
      await face.load();
      document.fonts.add(face);
      loadedFonts.add(label);
      note(before);
    } catch (e) {
      note(`글꼴을 받지 못했습니다 (${label}). 기본 글꼴로 보여 줍니다.`);
    }
    paper.clearFontCache();
  }
  render();
}

// --- 저장·불러오기 ---

let saveTimer = null;

function saveNow() {
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      text: state.doc.text, font: state.font, ratio: state.ratio, vertical: state.vertical,
    }));
  } catch (e) { /* 저장 공간이 없으면 그냥 넘어간다 */ }
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}

function restore() {
  let found = false;
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    // 빈 글이 저장돼 있으면 지킬 것이 없으므로 예시 글을 다시 넣는다
    if (typeof saved.text === "string" && saved.text.trim()) {
      state.doc = new Doc(saved.text);
      found = true;
    }
    if (typeof saved.ratio === "number") state.ratio = saved.ratio;
    if (typeof saved.vertical === "boolean") state.vertical = saved.vertical;
    if (FONTS.some((f) => f.label === saved.font)) state.font = saved.font;
  } catch (e) { /* 저장된 게 깨졌으면 새로 시작 */ }
  if (!found) {
    // 처음 열었을 때는 빈 원고지 대신 예시 글을 채워 둔다
    state.doc = new Doc(SAMPLE_TEXT);
    statusNote = "예시로 윤동주 「서시」를 넣어 두었습니다. 전체 → 지우기로 비울 수 있습니다.";
  }
  state.doc.moveTo(state.doc.text.length); // 이어서 쓸 수 있게 커서를 글 끝에
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

// --- 클립보드 (폰에는 ⌘C·⌘V가 없어 버튼으로 쓴다) ---

/** 클립보드 API가 막힌 기기를 위한 대비책. 잠깐 만든 입력칸으로 복사한다. */
function copyByTextarea(text) {
  const box = document.createElement("textarea");
  box.value = text;
  box.readOnly = true;
  box.style.cssText = "position:fixed;top:0;left:0;opacity:0";
  document.body.append(box);
  box.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch (e) {
    copied = false;
  }
  box.remove();
  return copied;
}

async function copySelection() {
  const selected = state.doc.selectedText();
  if (!selected) {
    note("먼저 글자를 선택하세요 (길게 눌렀다 끌기, 또는 전체 버튼)");
    return;
  }
  try {
    if (!navigator.clipboard) throw new Error("클립보드 없음");
    await navigator.clipboard.writeText(selected);
    note("복사했습니다");
  } catch (e) {
    note(copyByTextarea(selected) ? "복사했습니다" : "복사하지 못했습니다");
  }
  ime.focus({ preventScroll: true });
}

async function pasteClipboard() {
  let text = null;
  try {
    if (!navigator.clipboard) throw new Error("클립보드 없음");
    text = await navigator.clipboard.readText();
  } catch (e) {
    // 권한이 막힌 기기에서는 시스템 붙여넣기를 쓸 수 있는 입력창을 띄운다
    text = window.prompt("여기에 붙여넣기 한 다음 확인을 누르세요", "");
  }
  if (text) {
    state.doc.insert(text.replace(/\r\n?/g, "\n"), "paste");
    note("붙여넣었습니다");
  }
  ime.focus({ preventScroll: true });
  render();
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

// 마우스·펜: 누르면 커서, 끌면 선택.
// 손가락: 두드리면 커서, 두 번 두드리면 낱말 선택, 길게 눌렀다 끌면 범위 선택.
//         그냥 끌면 화면이 밀린다 (선택 버튼을 켜 두면 바로 끌어서 선택한다).
const LONG_PRESS_MS = 450;
const TAP_SLOP = 10; // 이만큼 안에서 움직이면 제자리로 본다 (화면 px)
const DOUBLE_TAP_MS = 320;

let dragging = false;
let press = null; // 손가락으로 누르고 있는 중의 정보
let lastTap = null;

const isWordChar = (ch) => Boolean(ch) && !/\s/.test(ch);

/** 띄어쓰기·줄바꿈 사이의 낱말을 선택한다. 고를 낱말이 없으면 false. */
function selectWord(index) {
  const { text } = state.doc;
  let start = isWordChar(text[index]) ? index : Math.max(0, index - 1);
  if (!isWordChar(text[start])) return false;
  let end = start;
  while (start > 0 && isWordChar(text[start - 1])) start -= 1;
  while (end < text.length && isWordChar(text[end])) end += 1;
  state.doc.moveTo(start);
  state.doc.moveTo(end, true);
  return true;
}

function startPress(e) {
  press = { id: e.pointerId, x: e.clientX, y: e.clientY,
            index: indexAtEvent(e, false), selecting: false };
  press.timer = setTimeout(() => {
    if (!press) return;
    press.selecting = true;
    state.doc.moveTo(press.index);
    try { svg.setPointerCapture(press.id); } catch (err) { /* 이미 뗀 손가락 */ }
    note("끌어서 선택하세요");
    render();
  }, LONG_PRESS_MS);
}

function endPress() {
  clearTimeout(press.timer);
  if (press.selecting) {
    try { svg.releasePointerCapture(press.id); } catch (err) { /* 이미 놓음 */ }
    note(state.doc.selectedText() ? "복사·지우기 버튼을 쓸 수 있습니다" : "");
  } else {
    const now = Date.now();
    const near = lastTap && Math.hypot(press.x - lastTap.x, press.y - lastTap.y) < 24;
    if (near && now - lastTap.time < DOUBLE_TAP_MS && selectWord(press.index)) {
      lastTap = null;
      note("낱말을 선택했습니다");
    } else {
      state.doc.moveTo(press.index);
      lastTap = { time: now, x: press.x, y: press.y };
    }
  }
  press = null;
  ime.focus({ preventScroll: true });
  render();
}

svg.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "touch" && !state.selectMode) {
    startPress(e);
    return;
  }
  e.preventDefault();
  ime.focus({ preventScroll: true });
  state.doc.moveTo(indexAtEvent(e, e.shiftKey), e.shiftKey);
  dragging = true;
  svg.setPointerCapture(e.pointerId);
  render();
});

svg.addEventListener("pointermove", (e) => {
  if (press && e.pointerId === press.id) {
    if (press.selecting) {
      state.doc.moveTo(indexAtEvent(e, true), true);
      render();
    } else if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > TAP_SLOP) {
      clearTimeout(press.timer); // 화면을 미는 중이다
      press = null;
    }
    return;
  }
  if (!dragging) return;
  state.doc.moveTo(indexAtEvent(e, true), true);
  render();
});

// 길게 눌러 선택하는 동안에는 화면이 밀리지 않게 막는다
svg.addEventListener("touchmove", (e) => {
  if (press && press.selecting) e.preventDefault();
}, { passive: false });

svg.addEventListener("pointerup", (e) => {
  if (press && e.pointerId === press.id) {
    endPress();
  } else if (dragging) {
    dragging = false;
    try { svg.releasePointerCapture(e.pointerId); } catch (err) { /* 이미 놓음 */ }
  }
});

svg.addEventListener("pointercancel", (e) => {
  if (press && e.pointerId === press.id) {
    clearTimeout(press.timer);
    press = null;
  } else if (dragging) {
    dragging = false;
    try { svg.releasePointerCapture(e.pointerId); } catch (err) { /* 이미 놓음 */ }
  }
});

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
$("selectMode").addEventListener("click", (e) => {
  state.selectMode = !state.selectMode;
  e.currentTarget.setAttribute("aria-pressed", String(state.selectMode));
  svg.classList.toggle("selecting", state.selectMode);
  note(state.selectMode ? "끌어서 글자를 선택하세요 (화면 밀기는 잠시 멈춥니다)" : "");
});
$("selectAll").addEventListener("click", () => {
  state.doc.selectAll();
  ime.focus({ preventScroll: true });
  render();
});
$("copy").addEventListener("click", () => copySelection());
$("paste").addEventListener("click", () => pasteClipboard());
$("erase").addEventListener("click", () => {
  state.doc.deleteToRowStart();
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
  // 새 버전이 자리를 잡으면 한 번만 새로고침해서 바로 반영한다.
  // 처음 설치될 때도 controllerchange가 오므로, 원래 있던 경우에만 새로고침한다.
  const hadWorker = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadWorker || reloading) return;
    reloading = true;
    saveNow(); // 쓰던 글을 먼저 저장하고 새로고침한다
    location.reload();
  });
  addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" })
      .then((registration) => registration.update())
      .catch(() => {});
  });
}
