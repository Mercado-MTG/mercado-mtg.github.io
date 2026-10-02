// Genera una página por carta en venta (c/<id>/index.html) con su vista previa para WhatsApp y redes
// (imagen, nombre, precio). WhatsApp no ejecuta JavaScript, por eso cada carta necesita su página fija.
// Al abrirla en el navegador, lleva directo a la carta dentro de la app.
import fs from 'node:fs';
import path from 'node:path';

const FEED = 'https://script.google.com/macros/s/AKfycbxn5R4v8c-0SpumGkuwnUhzcjhSr6-o_EBaoj8Uclo5RU7NEfcepyT0vcri1yPnnynd3Q/exec?feed=ventas';
const SITIO = 'https://mercado-mtg.github.io';
const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const DIR = path.join(RAIZ, 'c');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const soles = n => 'S/ ' + Number(n || 0).toFixed(2);

function pagina(l) {
  const titulo = `${l.n}${l.f ? ' (Foil)' : ''} · ${soles(l.p)}`;
  const desc = `${l.c} · ${l.s}${l.sc ? ' (' + l.sc + ')' : ''} · Vendida por ${l.v} en Mercado MTG. Pago protegido: el vendedor cobra cuando recibes tu carta.`;
  const url = `${SITIO}/c/${encodeURIComponent(l.id)}/`;
  const ir = `${SITIO}/?venta=${encodeURIComponent(l.id)}`;
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)} | Mercado MTG</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="product">
<meta property="og:site_name" content="Mercado MTG">
<meta property="og:title" content="${esc(titulo)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
${l.i ? `<meta property="og:image" content="${esc(l.i)}">` : `<meta property="og:image" content="${SITIO}/logo-512.png">`}
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/png" href="${SITIO}/favicon.png">
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0c0a1a;color:#e9e4f5;font:15px system-ui,-apple-system,"Segoe UI",sans-serif}
  .c{max-width:340px;padding:24px;text-align:center}
  img{width:100%;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.5)}
  h1{font-size:19px;margin:16px 0 4px}.p{font-size:24px;font-weight:800;color:#c9b9ff}.d{color:#a69fbb;font-size:13px}
  a{display:inline-block;margin-top:16px;padding:12px 18px;border-radius:12px;background:linear-gradient(135deg,#8b6cff,#5b8cff);color:#fff;font-weight:700;text-decoration:none}
</style>
</head>
<body>
<div class="c">
  ${l.i ? `<img src="${esc(l.i)}" alt="${esc(l.n)}">` : ''}
  <h1>${esc(l.n)}${l.f ? ' · Foil' : ''}</h1>
  <div class="p">${esc(soles(l.p))}</div>
  <div class="d">${esc(desc)}</div>
  <a href="${esc(ir)}">Ver en Mercado MTG</a>
</div>
<script>setTimeout(function(){ location.replace(${JSON.stringify(ir)}); }, 600);</script>
</body>
</html>
`;
}

const res = await fetch(FEED, { redirect: 'follow' });
if (!res.ok) throw new Error('El feed respondió ' + res.status);
const datos = await res.json();
const items = (datos.items || []).filter(l => l && /^[A-Za-z0-9_-]{1,64}$/.test(l.id));
fs.mkdirSync(DIR, { recursive: true });
const vigentes = new Set(items.map(l => l.id));
// las cartas que ya no están en venta dejan de tener página (el respaldo 404 lleva al mercado)
for (const d of fs.readdirSync(DIR)) if (!vigentes.has(d)) fs.rmSync(path.join(DIR, d), { recursive: true, force: true });
for (const l of items) {
  fs.mkdirSync(path.join(DIR, l.id), { recursive: true });
  fs.writeFileSync(path.join(DIR, l.id, 'index.html'), pagina(l));
}
console.log('Páginas de cartas:', items.length);
