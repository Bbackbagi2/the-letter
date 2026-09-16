// 오프라인에서도 열리도록 앱 파일을 캐시에 둔다. 글꼴은 쓸 때 받아서 따로 캐시한다.
const SHELL = "the-letter-shell-v3"; // 앱 파일 캐시를 갈아 끼울 때 숫자를 올린다
const FONTS = "the-letter-fonts-v3"; // 글꼴 파일을 다시 만들면 숫자를 올린다
const FONT_LIMIT = 3; // 글꼴은 최근 3개만 남긴다 (한 종이 2~3MB라 용량을 많이 먹는다)
const SHELL_FILES = ["./", "./index.html", "./app.js", "./layout.js", "./editor.js",
                     "./paper.js", "./fonts.js", "./sample.js", "./manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // cache: "reload"으로 받아야 브라우저가 10분간 들고 있는 낡은 파일을 피할 수 있다
    await Promise.all(SHELL_FILES.map(async (file) => {
      try {
        const res = await fetch(file, { cache: "reload" });
        if (res.ok) await cache.put(file, res);
      } catch (e) { /* 지금 못 받으면 쓸 때 받는다 */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== FONTS).map((k) => caches.delete(k))))
    .then(() => caches.open(FONTS))
    .then(trimFonts) // 예전에 3개를 넘게 받아 둔 것이 있으면 여기서 정리된다
    .then(() => self.clients.claim()));
});

/** 글꼴 캐시를 FONT_LIMIT개로 줄인다. 먼저 받은 것부터 버리는 큐 방식.
 *
 * cache.keys()는 넣은 순서대로 돌려주므로 앞쪽이 가장 오래된 것이다.
 */
async function trimFonts(cache) {
  const keys = await cache.keys();
  for (const request of keys.slice(0, Math.max(0, keys.length - FONT_LIMIT))) {
    await cache.delete(request);
  }
}

/** 글꼴: 한 번 받으면 그대로 쓴다 (내용이 바뀌면 FONTS 이름을 올려 통째로 버린다). */
async function fromCacheFirst(request) {
  const cache = await caches.open(FONTS);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    // 복제본을 반드시 끝까지 쓰고(또는 버리고) 나서 응답을 넘긴다.
    // 사파리에서는 복제만 해 두고 안 쓰면 원본 읽기가 멈출 수 있다.
    try {
      await cache.put(request, res.clone());
      await trimFonts(cache);
    } catch (e) { /* 저장 공간이 부족하면 캐시 없이 쓴다 */ }
  }
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
    if (res.ok) {
      try {
        await (await caches.open(SHELL)).put(request, res.clone());
      } catch (e) { /* 저장 공간이 부족하면 캐시 없이 쓴다 */ }
    }
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
