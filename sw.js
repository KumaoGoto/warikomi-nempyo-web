// ホーム画面に置ける形（PWA）のための手元の置き場（Service Worker）。初めて開いたときに遊ぶのに要るファイルを手元に置き、次からは通信がなくても遊べる。
// VERSION と PRECACHE（ファイルの名前 → 中身の印）は tool/web/make_sw.py が build/web/sw.js に書く（ここはひな形）。中身が変わると VERSION が変わり、
// 新しい置き場を作って古い置き場を捨てる。中身の変わっていないファイルは古い置き場から移す（更新のたびに全部を取り直さない）。
// 公開の形（tool/web/stage.py）では、プログラムは版ごとの箱 v/<VERSION>/ に入り、PRECACHE もその場所に書き換わる。

const VERSION = 'd101b8b09601';
const PRECACHE = {
  'assets/AssetManifest.bin': '68d3d813538cc550',
  'assets/AssetManifest.bin.json': '152780deb0490c4a',
  'assets/FontManifest.json': '03743dd7d3d3da76',
  'assets/assets/audio/correct.wav': '16c78f5ba877eabe',
  'assets/assets/audio/tap.wav': '8dc282ca3f14656f',
  'assets/assets/audio/wrong.wav': '0318d5c8eeec9845',
  'assets/assets/data/events.json': 'f870e4adb99e263c',
  'assets/assets/fonts/NotoSansJP-Regular.ttf': '008f59295801b93c',
  'assets/assets/fonts/NotoSansJP-SemiBold.ttf': 'b845652c1769e4c0',
  'assets/assets/fonts/ZenOldMincho-Bold.ttf': 'd239ac5ca83567c9',
  'assets/assets/fonts/ZenOldMincho-Regular.ttf': '936f3424be2240be',
  'assets/assets/ranking/ng_words.json': 'e2fdd6e04cfbaa42',
  'assets/fonts/MaterialIcons-Regular.otf': '4be32c1a0f18a0b2',
  'assets/shaders/ink_sparkle.frag': '2dca5ab93d4ec29e',
  'assets/shaders/stretch_effect.frag': 'ab412f07a5b9b50b',
  'v/d101b8b09601/canvaskit/canvaskit.js': '7361b744487f9826',
  'v/d101b8b09601/canvaskit/canvaskit.wasm': '6bdfaa51c76845c0',
  'v/d101b8b09601/flutter_bootstrap.js': '997993cdd0555f07',
  'icons/apple-touch-icon.png': '5405d6ab9e0c9a4d',
  'icons/favicon-32.png': '2268911fa6fee617',
  'icons/icon-192.png': 'b198a225faf31279',
  'icons/icon-512.png': '72903782cc3f28c8',
  'icons/icon-maskable-512.png': '05f8a103e19511da',
  'index.html': 'd101b8b09601',
  'v/d101b8b09601/main.dart.js': 'ea4c572bbcd1d889',
  'manifest.webmanifest': '7a2ead77621a4bc3',
};
// @@PRECACHE_END

const CACHE = `warikomi-${VERSION}`;

self.addEventListener('install', (e) => {
  e.waitUntil(fill().then(() => self.skipWaiting()));
});

async function fill() {
  const cache = await caches.open(CACHE);
  const missing = await moveUnchanged(cache);
  // 残りは、ブラウザの HTTP の置き場（GitHub Pages は 10 分置かせる）を通さず、いまサイトにある物を取りに行って置く
  // （通すと、新しい版の名前の置き場に古いファイルを入れてしまい、次の版まで新旧が混ざって動く）。
  // 版の箱 v/<VERSION>/ の中だけは名前が版ごとに違って混ざらないので HTTP の置き場を使う（初めての人が CanvasKit とプログラムを 2 回落とさない）
  await cache.addAll(missing.map((u) => new Request(u, { cache: u.startsWith('v/') ? 'default' : 'reload' })));
}

/** 版の箱を除いた名前（版が変わっても同じファイルを見つける） */
const withoutBox = (name) => name.replace(/^v\/[0-9a-f]+\//, '');

/** 中身の印（tool/web/make_sw.py と同じ。SHA-256 の頭 16 けた） */
async function mark(bytes) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...hash].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

/** 古い置き場から、中身の印が同じファイルを移す。移せなかったファイルの名前を返す */
async function moveUnchanged(cache) {
  const scope = new URL(self.registration.scope).pathname;
  const old = new Map();
  for (const name of await caches.keys()) {
    if (name === CACHE || !name.startsWith('warikomi-')) continue;
    const c = await caches.open(name);
    for (const req of await c.keys()) {
      old.set(withoutBox(new URL(req.url).pathname.slice(scope.length)), [c, req]);
    }
  }
  const missing = [];
  for (const [name, expected] of Object.entries(PRECACHE)) {
    const found = old.get(withoutBox(name));
    const res = found && (await found[0].match(found[1]));
    const bytes = res && (await res.arrayBuffer());
    if (bytes && (await mark(bytes)) === expected) {
      await cache.put(name, new Response(bytes, { headers: { 'content-type': res.headers.get('content-type') ?? 'application/octet-stream' } }));
    } else {
      missing.push(name);
    }
  }
  return missing;
}

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('warikomi-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** ゲームのページ（置き場の頭か index.html）を開く要求か。ほかのページはそのページのまま返す */
function isGamePage(req, url) {
  if (req.mode !== 'navigate') return false;
  const scope = new URL(self.registration.scope).pathname;
  return url.pathname === scope || url.pathname === `${scope}index.html`;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // ランキング（別の場所の API）・足りない字（Google のフォント配信）と POST は手元に置かない
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const game = isGamePage(req, url);
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // ゲームのページは手元の index.html を先に（通信がなくても開ける。?fps などの後ろは見ない）
    const hit = await cache.match(game ? 'index.html' : req, { ignoreSearch: game });
    if (hit) return hit;
    const res = await fetch(req);
    // 初めて読んだものも置いておく（次は通信なしで使える）。置き終わるまで Service Worker を止めさせない
    if (res.ok && res.type === 'basic') e.waitUntil(cache.put(req, res.clone()));
    return res;
  })());
});
