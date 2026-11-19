// Construit le site : récupère chaque dépôt, le transforme en application installable (PWA)
// et génère la page d'accueil avec tous les liens.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const cfg = JSON.parse(fs.readFileSync('apps.json', 'utf8'));
const OUT = 'site';
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

// ---------- icône PNG (sans dépendance) ----------
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function hslToRgb(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
}
function makeIcon(size, hue) {
  const [r, g, b] = hslToRgb(hue, 0.65, 0.42);
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c) / size;
      // fond plein (compatible « maskable »), point central + 2 anneaux = ondes radio
      const white = d < 0.07 || (d > 0.17 && d < 0.22) || (d > 0.30 && d < 0.35);
      const i = y * (size * 4 + 1) + 1 + x * 4;
      raw[i] = white ? 255 : r; raw[i + 1] = white ? 255 : g; raw[i + 2] = white ? 255 : b; raw[i + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const slugOf = (repo) => repo.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hueOf = (s) => [...s].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 360, 7);

const built = [];
const skipped = [];

for (const repo of cfg.repos) {
  const url = `https://raw.githubusercontent.com/${cfg.owner}/${repo}/HEAD/index.html`;
  let html;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (e) { skipped.push([repo, `téléchargement impossible (${e.message})`]); continue; }

  if (!/<html[\s>]|<!doctype html/i.test(html.slice(0, 2000))) { skipped.push([repo, "ce n'est pas une page web valide"]); continue; }

  const slug = slugOf(repo);
  const dir = path.join(OUT, slug);
  fs.mkdirSync(dir, { recursive: true });

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const name = (titleMatch?.[1] || repo).replace(/\s+/g, ' ').trim() || repo;
  const hue = hueOf(repo);
  const [tr, tg, tb] = hslToRgb(hue, 0.65, 0.30);
  const theme = '#' + [tr, tg, tb].map((v) => v.toString(16).padStart(2, '0')).join('');

  // --- transformation de la page ---
  html = html.replace(/<link[^>]+rel=["']manifest["'][^>]*>/gi, '');
  const headTags = [
    !/name=["']viewport["']/i.test(html) ? '<meta name="viewport" content="width=device-width, initial-scale=1">' : '',
    '<link rel="manifest" href="manifest.webmanifest">',
    `<meta name="theme-color" content="${theme}">`,
    '<link rel="icon" href="icon-192.png">',
    '<link rel="apple-touch-icon" href="icon-192.png">',
  ].join('\n');
  html = /<head[^>]*>/i.test(html)
    ? html.replace(/<head[^>]*>/i, (m) => `${m}\n${headTags}`)
    : html.replace(/<html[^>]*>/i, (m) => `${m}\n<head>\n${headTags}\n</head>`);
  const reg = `<script>if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('./sw.js').catch(function(){});});}</script>`;
  html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${reg}\n</body>`) : html + '\n' + reg;
  fs.writeFileSync(path.join(dir, 'index.html'), html);

  fs.writeFileSync(path.join(dir, 'manifest.webmanifest'), JSON.stringify({
    id: './', name, short_name: name.slice(0, 12), description: `Application ${name}`,
    start_url: './', scope: './', display: 'standalone', orientation: 'any',
    background_color: theme, theme_color: theme,
    icons: [
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  }, null, 2));
  fs.writeFileSync(path.join(dir, 'icon-192.png'), makeIcon(192, hue));
  fs.writeFileSync(path.join(dir, 'icon-512.png'), makeIcon(512, hue));
  fs.writeFileSync(path.join(dir, 'sw.js'), `const CACHE='${slug}-v1';
const SHELL=['./','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  const r=e.request;
  if(r.method!=='GET'||new URL(r.url).origin!==self.location.origin)return;
  e.respondWith(fetch(r).then(res=>{const copy=res.clone();caches.open(CACHE).then(c=>c.put(r,copy));return res;}).catch(()=>caches.match(r).then(m=>m||caches.match('./'))));
});
`);
  built.push({ repo, slug, name, hue });
}

// ---------- page d'accueil ----------
const cards = built.map((a) => `
  <a class="card" href="./${a.slug}/" style="--h:${a.hue}">
    <img src="./${a.slug}/icon-192.png" alt="" width="56" height="56">
    <span><strong>${esc(a.name)}</strong><small>${esc(a.repo)}</small></span>
  </a>`).join('');
fs.writeFileSync(path.join(OUT, 'index.html'), `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mes applications</title>
<style>
:root{color-scheme:dark}
body{margin:0;font-family:system-ui,sans-serif;background:#0d1117;color:#e6edf3;padding:20px;max-width:760px;margin-inline:auto}
h1{font-size:1.5rem}
p{color:#9da7b3;line-height:1.5}
.grid{display:grid;gap:12px;margin:20px 0}
.card{display:flex;gap:14px;align-items:center;padding:12px;border-radius:14px;background:#161b22;border:1px solid #30363d;color:inherit;text-decoration:none}
.card:active,.card:hover{border-color:hsl(var(--h),65%,55%)}
.card img{border-radius:12px}
.card strong{display:block}
.card small{color:#7d8590;word-break:break-all}
</style></head><body>
<h1>Mes applications</h1>
<p>Ouvre une application, puis dans Chrome : menu <strong>⋮</strong> → <strong>Installer l'application</strong> (ou « Ajouter à l'écran d'accueil » sur téléphone).</p>
<div class="grid">${cards}
</div>
<p><small>${built.length} applications — mise à jour automatique depuis GitHub.</small></p>
</body></html>`);

fs.writeFileSync(path.join(OUT, 'apps-built.json'), JSON.stringify(built, null, 2));
console.log(`OK : ${built.length} applications construites`);
for (const b of built) console.log(`  https://${cfg.owner}.github.io/${cfg.site}/${b.slug}/  <- ${b.repo} (${b.name})`);
for (const [r, why] of skipped) console.log(`IGNORÉ : ${r} -> ${why}`);
