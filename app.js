// 화면과 입력 처리. 배치 계산은 layout.js, 그리기는 paper.js.
//
// 글을 담는 곳은 종이 위에 덮인 투명한 textarea(#ime)다. 글자 폭이 모두 한 칸인
// 전용 글꼴(tl-grid)을 씌워서, 브라우저가 글자를 원고지 칸과 똑같은 격자에 배치한다.
// 그래서 커서·선택·복사 풍선·키보드·받아쓰기 같은 편집 기능을 기기가 원래 하던 방식
// 그대로 쓸 수 있다. 눈에 보이는 글자는 그 아래 SVG가 손글씨 글꼴로 그린다.

import { COLS, ROWS, cursorPositions, indexAt, overflowCount } from "./layout.js";
import * as paper from "./paper.js";
import { FONTS, DEFAULT_FONT } from "./fonts.js";
import { SAMPLE_TEXT } from "./sample.js";

const INK = "#222222";
const PREEDIT_INK = "#B4B4B4";
const STORE_KEY = "the-letter";
const FONT_CACHE = "the-letter-fonts-v3"; // sw.js의 FONTS와 같은 이름이어야 한다
const FONT_LIMIT = 3; // sw.js의 FONT_LIMIT와 같은 값
const IME_PX = 10; // 입력칸은 1mm를 10px로 놓고 짜고, 변환으로 줄인다 (배치 정밀도)

const $ = (id) => document.getElementById(id);
const svg = $("paper");
const ime = $("ime");
const statusBar = $("status");

const state = {
  preedit: null, // 조합 중인 글자 구간 [시작, 끝]
  vertical: false,
  ratio: paper.TEXT_RATIO,
  form: "a4",
  font: DEFAULT_FONT,
  name: "편지",
  printing: false,
};
const loadedFonts = new Set();
const loadedFaces = []; // 이번에 켜 둔 동안 등록한 글꼴 (먼저 받은 것부터)
const FAMILIES = new Map(FONTS.map((f, i) => [f.label, `tl-font-${i}`]));
const familyOf = (label) => FAMILIES.get(label) || label;
let statusNote = "";

// --- 그리기 ---

function render() {
  const { vertical, printing } = state;
  const rotated = vertical && !printing;
  svg.setAttribute("viewBox", rotated ? `0 0 ${paper.PAGE_H} ${paper.PAGE_W}`
    : `0 0 ${paper.PAGE_W} ${paper.PAGE_H}`);
  const inner = paper.pageSVG(ime.value, {
    family: familyOf(state.font), ratio: state.ratio, vertical,
    ink: INK, preeditInk: PREEDIT_INK, preeditRange: state.preedit,
    showTrim: !printing, // 잘려 나갈 자리는 화면에서만 옅게 (인쇄 잉크를 쓰지 않는다)
  });
  // 세로 모드 화면: 종이를 시계 방향 90° 돌려 보여 준다 (1줄이 오른쪽 끝 열)
  svg.innerHTML = rotated
    ? `<g id="content" transform="translate(${paper.PAGE_H} 0) rotate(90)">${inner}</g>`
    : `<g id="content">${inner}</g>`;
  placeIme();
  showStatus();
  save();
}

/** 투명 입력칸을 원고지 격자에 맞춰 올려 놓는다.
 *
 * 종이와 같은 변환(getScreenCTM)을 그대로 CSS transform으로 쓰기 때문에 확대나
 * 세로쓰기 회전까지 자동으로 따라간다. 글자 상자 높이가 한 칸(CELL)이고 줄 높이가
 * 칸+띠이므로, 남는 띠의 절반(BAND/2)만큼 위로 올려야 첫 줄이 첫 칸에 맞는다.
 */
function placeIme() {
  const content = svg.querySelector("#content");
  const ctm = content && content.getScreenCTM();
  if (!ctm) return;
  ime.style.fontSize = `${paper.CELL * IME_PX}px`;
  ime.style.lineHeight = `${(paper.CELL + paper.BAND) * IME_PX}px`;
  ime.style.width = `${COLS * paper.CELL * IME_PX}px`;
  ime.style.height = `${ROWS * (paper.CELL + paper.BAND) * IME_PX}px`;
  const matrix = new DOMMatrix([ctm.a, ctm.b, ctm.c, ctm.d, ctm.e, ctm.f])
    .translate(paper.GRID_X, paper.GRID_Y + paper.BAND / 2)
    .scale(1 / IME_PX);
  ime.style.transform = matrix.toString();
}

function showStatus() {
  const text = ime.value;
  const over = overflowCount(text);
  const parts = [];
  if (statusNote) parts.push(statusNote);
  parts.push(`${[...text].filter((c) => c !== "\n").length}자`);
  if (over) parts.push(`${ROWS}줄을 넘은 ${over}자는 인쇄되지 않습니다`);
  statusBar.textContent = parts.join(" · ");
}

function note(text) {
  statusNote = text;
  showStatus();
}

/** 놓치면 안 되는 문제는 위쪽에 띠로 띄우고, 닫을 때까지 남겨 둔다. */
function alarm(text) {
  $("bannerText").textContent = text;
  $("banner").hidden = false;
}

// --- 커서 (기기 기본 편집 기능을 그대로 쓰고, 원고지 규칙만 거든다) ---

const caretIndex = () =>
  (ime.selectionDirection === "backward" ? ime.selectionStart : ime.selectionEnd);

function moveTo(index, extend) {
  const to = Math.max(0, Math.min(index, ime.value.length));
  if (!extend) {
    ime.setSelectionRange(to, to);
    return;
  }
  const back = ime.selectionDirection === "backward";
  const anchor = back ? ime.selectionEnd : ime.selectionStart;
  if (to < anchor) ime.setSelectionRange(to, anchor, "backward");
  else ime.setSelectionRange(anchor, to, "forward");
}

/** 같은 칸 번호로 이전/다음 줄. 세로 모드에서 ←→ 를 이 동작에 쓴다. */
function moveRow(step, extend) {
  const text = ime.value;
  const [row, col] = cursorPositions(text)[caretIndex()];
  moveTo(indexAt(text, row + step, col), extend);
}

/** 커서가 있는 줄의 첫 칸까지 지운다 (⌘⌫). 이미 첫 칸이면 한 글자. */
function deleteToRowStart() {
  if (ime.selectionStart !== ime.selectionEnd) {
    ime.setRangeText("", ime.selectionStart, ime.selectionEnd, "end");
  } else {
    const text = ime.value;
    const caret = caretIndex();
    const [row] = cursorPositions(text)[caret];
    const start = indexAt(text, row, 0);
    const from = start === caret ? Math.max(0, caret - 1) : start;
    ime.setRangeText("", from, caret, "end");
  }
  render();
}

// 세로 모드에서는 화면이 돌아가 있으므로 방향키도 화면 기준으로 맞춰 준다
const VERTICAL_ARROWS = {
  ArrowUp: ["char", -1], ArrowDown: ["char", 1],
  ArrowRight: ["row", -1], ArrowLeft: ["row", 1],
};

ime.addEventListener("keydown", (e) => {
  if (e.isComposing) return;
  const command = e.metaKey || e.ctrlKey;
  if (command && e.key.toLowerCase() === "s") {
    e.preventDefault();
    downloadText();
    return;
  }
  if (command && e.key === "Backspace") {
    e.preventDefault();
    deleteToRowStart();
    return;
  }
  const arrow = state.vertical && !command && VERTICAL_ARROWS[e.key];
  if (arrow) {
    e.preventDefault();
    if (arrow[0] === "char") moveTo(caretIndex() + arrow[1], e.shiftKey);
    else moveRow(arrow[1], e.shiftKey);
  }
});

// --- 글자 입력 ---

ime.addEventListener("input", () => render());

let composeStart = 0;
ime.addEventListener("compositionstart", () => { composeStart = ime.selectionStart; });
ime.addEventListener("compositionupdate", (e) => {
  // 조합 중인 글자는 옅게 그려서 아직 확정되지 않았음을 보여 준다
  state.preedit = [composeStart, composeStart + (e.data || "").length];
});
ime.addEventListener("compositionend", () => {
  state.preedit = null;
  render();
});

// 30줄을 넘겨도 입력칸이 스스로 스크롤되면 격자가 어긋난다. 늘 맨 위에 붙여 둔다.
ime.addEventListener("scroll", () => {
  ime.scrollTop = 0;
  ime.scrollLeft = 0;
});

// --- 글꼴 ---

function progress(fraction) {
  const bar = $("progress");
  bar.hidden = fraction === null;
  bar.classList.toggle("unknown", fraction === -1);
  $("progressBar").style.width = fraction > 0 ? `${Math.round(fraction * 100)}%` : "0%";
}

/** 실제로 있는 글꼴 주소를 찾는다.
 *
 * 한글 파일 이름은 완성형(NFC)과 분해형(NFD) 두 표기가 있고 서버는 한쪽만 인정한다.
 * 목록이 브라우저 캐시에 낡은 채로 남아 있으면 없는 쪽으로 요청해 404가 난다.
 */
async function findFontUrl(file) {
  const names = [...new Set([file, file.normalize("NFC"), file.normalize("NFD")])];
  for (const name of names) {
    const url = `fonts/${encodeURIComponent(name)}`;
    try {
      const head = await fetch(url, { method: "HEAD" });
      if (head.ok) return url;
    } catch (e) { /* 다음 표기를 본다 */ }
  }
  return `fonts/${encodeURIComponent(file.normalize("NFC"))}`;
}

/** 글꼴 파일을 받아 등록한다. 기기마다 막히는 방식이 달라 세 가지를 차례로 해 본다. */
async function loadFont(info, family) {
  const url = await findFontUrl(info.file);
  const ways = [
    ["받아서 등록", async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const total = Number(response.headers.get("content-length")) || 0;
      const reader = response.body && response.body.getReader();
      let data;
      if (reader) {
        const chunks = [];
        let received = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;
          progress(total ? received / total : -1);
        }
        data = await new Blob(chunks).arrayBuffer();
      } else {
        data = await response.arrayBuffer();
      }
      const face = new FontFace(family, data);
      await face.load();
      document.fonts.add(face);
      return face;
    }],
    ["주소로 등록", async () => {
      const face = new FontFace(family, `url("${url}")`);
      await face.load();
      document.fonts.add(face);
      return face;
    }],
    ["CSS로 등록", async () => {
      const style = document.createElement("style");
      style.textContent =
        `@font-face { font-family: "${family}"; src: url("${url}") format("woff2"); }`;
      document.head.append(style);
      await document.fonts.load(`100px "${family}"`, "가");
      if (!document.fonts.check(`100px "${family}"`, "가")) throw new Error("적용되지 않음");
    }],
  ];
  const problems = [];
  for (const [how, run] of ways) {
    try {
      return await run(); // 등록한 FontFace (CSS로 등록한 경우에는 undefined)
    } catch (e) {
      problems.push(`${how} ${e.name || ""} ${e.message || e}`.trim());
    }
  }
  throw new Error(problems.join(" / "));
}

/** 브라우저에 저장돼 있는 글꼴 파일 이름들 (먼저 받은 것부터). */
async function cachedFontFiles() {
  try {
    const cache = await caches.open(FONT_CACHE);
    const keys = await cache.keys();
    return keys.map((r) => decodeURIComponent(r.url.split("/").pop()));
  } catch (e) {
    return []; // 캐시를 못 쓰는 기기에서는 빈 칸으로 둔다
  }
}

/** 아이콘의 점을 저장된 글꼴 수만큼 채운다. tell이면 목록을 아래쪽에 알려 준다. */
async function showFontCache(tell = false) {
  const files = await cachedFontFiles();
  const names = files.map((file) => {
    const found = FONTS.find((f) => f.file === file);
    return found ? found.label : file;
  });
  const button = $("fontCache");
  button.querySelectorAll(".slot").forEach((slot, i) => {
    slot.classList.toggle("on", i < names.length);
  });
  const text = names.length
    ? `저장된 글꼴 ${names.length}/${FONT_LIMIT}: ${names.join(", ")}`
    : `저장된 글꼴 없음 (최대 ${FONT_LIMIT}개)`;
  button.title = text;
  if (tell) note(text);
}

/** 화면에 안 쓰는 글꼴은 메모리에서도 놓아 준다. 저장된 글꼴처럼 3개까지만 들고 있는다. */
function trimLoadedFonts() {
  while (loadedFaces.length > FONT_LIMIT) {
    const oldest = loadedFaces.findIndex((f) => f.label !== state.font);
    if (oldest < 0) break;
    const [dropped] = loadedFaces.splice(oldest, 1);
    try {
      document.fonts.delete(dropped.face);
    } catch (e) { /* 지울 수 없으면 그대로 둔다 */ }
    loadedFonts.delete(dropped.label);
  }
}

async function useFont(label) {
  state.font = label;
  const info = FONTS.find((f) => f.label === label);
  if (info && !loadedFonts.has(label)) {
    progress(0);
    try {
      const face = await loadFont(info, familyOf(label));
      loadedFonts.add(label);
      if (face) loadedFaces.push({ label, face });
      trimLoadedFonts();
    } catch (e) {
      alarm(`${label}을 받지 못했습니다 — ${e.message}`);
    }
    progress(null);
  }
  // 글꼴이 준비되기 전에 잰 글자 크기가 남아 있을 수 있으니 항상 지운다
  paper.clearFontCache();
  render();
  showFontCache();
}

// --- 저장·불러오기 ---

let saveTimer = null;

function saveNow() {
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      text: ime.value, font: state.font, ratio: state.ratio,
      vertical: state.vertical, name: state.name, form: state.form,
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
      ime.value = saved.text;
      found = true;
    }
    if (typeof saved.ratio === "number") state.ratio = saved.ratio;
    if (typeof saved.vertical === "boolean") state.vertical = saved.vertical;
    if (FONTS.some((f) => f.label === saved.font)) state.font = saved.font;
    if (typeof saved.name === "string" && saved.name.trim()) state.name = saved.name;
    if (paper.FORMS[saved.form]) state.form = saved.form;
  } catch (e) { /* 저장된 게 깨졌으면 새로 시작 */ }
  paper.setForm(state.form);
  if (!found) {
    // 처음 열었을 때는 빈 원고지 대신 예시 글을 채워 둔다
    ime.value = SAMPLE_TEXT;
    statusNote = "예시로 윤동주의 시를 넣어 두었습니다";
  }
  const end = ime.value.length;
  ime.setSelectionRange(end, end); // 이어서 쓸 수 있게 커서를 글 끝에
}

/** 파일 이름으로 쓸 수 없는 글자를 걷어낸다. */
function safeName(text) {
  const clean = (text || "").replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim();
  return clean || "편지";
}

function downloadText() {
  const name = safeName(state.name);
  // 맨 앞에 BOM을 붙인다. 이게 없으면 메모장 같은 프로그램이 UTF-8인 줄 모르고
  // 다른 인코딩으로 읽어서 글자가 깨진다. 불러올 때는 openFile에서 다시 떼어 낸다.
  const blob = new Blob(["﻿", ime.value], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  note(`${name}.txt로 내려받았습니다`);
}

function openFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    ime.value = String(reader.result).replace(/^﻿/, "").replace(/\r\n?/g, "\n");
    state.preedit = null;
    state.name = safeName(file.name.replace(/\.txt$/i, ""));
    $("name").value = state.name;
    const end = ime.value.length;
    ime.setSelectionRange(end, end);
    note(`불러옴: ${file.name}`);
    render();
  };
  reader.onerror = () => alarm(`${file.name}을 읽지 못했습니다`);
  reader.readAsText(file, "utf-8");
}

// --- 도구 모음 ---

$("bannerClose").addEventListener("click", () => { $("banner").hidden = true; });
$("name").addEventListener("input", (e) => {
  state.name = e.target.value;
  save();
});
$("open").addEventListener("click", () => $("file").click());
$("file").addEventListener("change", (e) => {
  if (e.target.files[0]) openFile(e.target.files[0]);
  e.target.value = "";
});
$("save").addEventListener("click", downloadText);
$("print").addEventListener("click", () => window.print());
$("vertical").addEventListener("click", (e) => {
  state.vertical = !state.vertical;
  e.currentTarget.setAttribute("aria-pressed", String(state.vertical));
  ime.focus({ preventScroll: true });
  render();
});
$("form").addEventListener("change", (e) => {
  state.form = e.target.value;
  paper.setForm(state.form);
  const f = paper.FORMS[state.form];
  note(f.cut ? `${f.label} — A4에 인쇄해서 자르고 접습니다` : f.label);
  ime.focus({ preventScroll: true });
  render();
});
$("font").addEventListener("change", (e) => useFont(e.target.value));
$("fontCache").addEventListener("click", () => showFontCache(true));
$("size").addEventListener("input", (e) => {
  state.ratio = Number(e.target.value) / 100;
  $("sizeValue").textContent = `${e.target.value}%`;
  render();
});

// 인쇄할 때는 세로 모드여도 용지를 원래 방향(A4 세로)으로 두고 글자만 눕힌다.
// 브라우저는 PDF로 저장할 때 문서 제목을 파일 이름으로 쓰므로 잠시 바꿔 둔다.
const APP_TITLE = document.title;
addEventListener("beforeprint", () => {
  document.title = safeName(state.name);
  state.printing = true;
  render();
});
addEventListener("afterprint", () => {
  document.title = APP_TITLE;
  state.printing = false;
  render();
});
addEventListener("resize", () => render());
if (window.visualViewport) {
  // 확대하거나 키보드가 올라오면 종이 위치가 바뀐다. 입력칸도 같이 옮긴다.
  visualViewport.addEventListener("resize", placeIme);
  visualViewport.addEventListener("scroll", placeIme);
}

// --- 시작 ---

restore();
for (const f of FONTS) {
  const option = document.createElement("option");
  option.value = f.label;
  option.textContent = `${f.label} (${(f.kb / 1024).toFixed(1)}MB)`;
  $("font").append(option);
}
for (const [name, f] of Object.entries(paper.FORMS)) {
  const option = document.createElement("option");
  option.value = name;
  option.textContent = f.label;
  $("form").append(option);
}
$("form").value = state.form;
$("font").value = state.font;
$("name").value = state.name;
$("size").value = Math.round(state.ratio * 100);
$("sizeValue").textContent = `${Math.round(state.ratio * 100)}%`;
$("vertical").setAttribute("aria-pressed", String(state.vertical));
render();
useFont(state.font);
showFontCache();
ime.focus({ preventScroll: true });
// 글꼴이 늦게 준비되는 경우가 있어, 준비되면 크기를 다시 재서 그린다
if (document.fonts && document.fonts.addEventListener) {
  document.fonts.addEventListener("loadingdone", () => {
    paper.clearFontCache();
    render();
  });
}

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
