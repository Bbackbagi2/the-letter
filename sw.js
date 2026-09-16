// 오프라인에서도 열리도록 앱 파일을 캐시에 둔다. 글꼴은 쓸 때 받아서 따로 캐시한다.
const SHELL = "the-letter-shell-v2"; // 앱 파일 캐시를 갈아 끼울 때 숫자를 올린다
const FONTS = "the-letter-fonts-v3"; // 글꼴 파일을 다시 만들면 숫자를 올린다
const SHELL_FILES = ["./", "./index.html", "./app.js", "./layout.js", "./editor.js",
                     "./paper.js", "./fonts.js", "./sample.js", "./manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== FONTS).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

/** 글꼴: 한 번 받으면 그대로 쓴다 (내용이 바뀌면 FONTS 이름을 올려 통째로 버린다). */
async function fromCacheFirst(request) {
  const cache = await caches.open(FONTS);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

/** 앱 파일: 새 것을 먼저 받아 보고, 연결이 없으면 캐시에 둔 것으로 연다.
 *
 * GitHub Pages가 max-age=600을 붙여 주므로 그냥 fetch하면 최대 10분 묵은 파일을 받는다.
 * cache: "no-cache"로 서버에 매번 물어보게 한다 (안 바뀌었으면 304라 거의 공짜다).
 */
async function fromNetworkFirst(request) {
  try {
    const res = await fetch(request.url, { cache: "no-cache", credentials: "same-origin" });
    if (res.ok) (await caches.open(SHELL)).put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await caches.match(request);
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(url.pathname.includes("/fonts/")
    ? fromCacheFirst(e.request)
    : fromNetworkFirst(e.request));
});
