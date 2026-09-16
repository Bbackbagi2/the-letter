# 원고지 편집기 (웹)

키보드로 쓴 글을 20×30 원고지 칸에 한 자씩 놓고, 손글씨 글꼴로 인쇄하거나 PDF로 내보내는 웹 앱.
데스크톱(PySide6) 버전과 배치·치수 규칙이 같고, 계산 로직만 JavaScript로 옮겼다.

## 파일

| 파일 | 하는 일 |
|---|---|
| `index.html` | 화면 틀과 도구 모음 |
| `layout.js` | 글자 → (줄, 칸) 배치 계산 |
| `editor.js` | 커서·선택·실행 취소 |
| `paper.js` | 원고지와 글자를 SVG(단위 mm)로 그리기 |
| `app.js` | 입력·글꼴·저장·인쇄 연결 |
| `fonts.js`, `fonts/` | 글꼴 목록과 woff2 파일 (`tools/build_fonts.py`가 만든다) |
| `manifest.webmanifest`, `sw.js`, `icon-*.png` | 홈 화면에 추가해서 앱처럼 쓰기 위한 것 |

## 폰에서 쓰기 — GitHub Pages에 올리기

글꼴이 26MB라 인터넷 연결이 필요하다. 한 번 받은 글꼴은 브라우저 캐시에 남아
폰 저장 공간을 직접 차지하지 않는다 (공간이 모자라면 브라우저가 알아서 지운다).

```bash
cd web
git init -b main
git add .
git commit -m "원고지 편집기 웹 앱"
gh repo create the-letter --public --source=. --push
```

올린 뒤 저장소 **Settings → Pages → Source**를 `main` 브랜치 `/ (root)`로 지정한다
(또는 `gh api -X POST repos/Bbackbagi2/the-letter/pages -f "source[branch]=main" -f "source[path]=/"`).

1~2분 뒤 `https://bbackbagi2.github.io/the-letter/` 가 열린다.
폰 사파리/크롬에서 그 주소를 열고 **공유 → 홈 화면에 추가**를 누르면 앱처럼 실행된다.

> 글꼴 파일을 함께 올리는 것은 재배포에 해당한다. 나눔손글씨(OFL)와 독립운동가 서체(GS칼텍스)의
> 재배포·출처 표기 조건을 확인한 뒤 공개 저장소로 둘지 정하는 게 좋다. 확실하지 않은 부분이다.

## 맥에서 바로 열어 보기

```bash
cd web && python3 -m http.server 8765
```

`http://127.0.0.1:8765` 로 접속한다. (`file://`로 열면 ES 모듈이 막혀 동작하지 않는다.)

## 글꼴을 바꾸거나 굵기를 고칠 때

`resources/font/`에 글꼴을 넣거나 빼고 다시 변환한다.

```bash
source .venv/bin/activate && python3 tools/build_fonts.py
```

- 변환할 때 글리프 감김 방향을 정리한다 (반대로 감긴 획이 macOS에서 연하게 찍히는 문제).
- 획을 가늘게 할 글꼴은 `tools/build_fonts.py`의 `THINNING` 표에 적는다 (단위: em 1000 기준).
- 글꼴 파일을 다시 만들었으면 `sw.js`의 `FONTS` 캐시 이름 숫자를 올려야 폰에서 새로 받는다.

## 쓰는 법

| 조작 | 하는 일 |
|---|---|
| 클릭·탭 | 커서 옮기기 (마우스로 끌면 선택) |
| ⌘A / ⌘C / ⌘X / ⌘V | 전체 선택·복사·잘라내기·붙여넣기 |
| ⌘Z / ⌘⇧Z | 실행 취소 / 다시 실행 |
| ⌘⌫ | 그 줄 첫 칸까지 지우기 |
| ⌘S | 편지.txt로 내려받기 |
| 세로쓰기 | 종이를 돌려 세로로 쓰기 (인쇄는 A4 세로 그대로, 글자만 눕는다) |
| 인쇄 · PDF | 브라우저 인쇄 창 — 배율 100%, 여백 없음으로 두어야 칸이 6.6mm로 나온다 |

글은 브라우저에 자동 저장되어 다시 열면 이어서 쓸 수 있다.
