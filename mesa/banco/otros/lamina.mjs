// Lámina de la mesa: alzado lateral acotado + respuesta (directo + reflexiones) de tu mesa y de la nueva.
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '/home/user/acustica3d/acustica3d/node_modules/playwright/index.mjs';
const { f, curves } = JSON.parse(readFileSync('curves.json', 'utf8'));
// ── alzado (vista lateral, la pared frontal a la izquierda): Y de SketchUp en horizontal, Z en vertical ──
const S = 260, ox = 40, oy = 370; // px por m, origen
const X = (y) => ox + (y - 4.0) * S, Yp = (z) => oy - z * S * 0.95;
const rect = (y0, y1, z0, z1, fill, stroke = '#444') => `<rect x="${X(y1)}" y="${Yp(z1)}" width="${(y1 - y0) * S}" height="${(z1 - z0) * S * 0.95}" fill="${fill}" stroke="${stroke}" stroke-width="1"/>`;
// el eje Y de SketchUp crece hacia la pared frontal: X(y) se dibuja al revés para que la pared quede a la izquierda
const Xr = (y) => ox + (6.75 - y) * S;
const R = (y0, y1, z0, z1, fill, stroke = '#444') => `<rect x="${Xr(Math.max(y0, y1))}" y="${Yp(z1)}" width="${Math.abs(y1 - y0) * S}" height="${(z1 - z0) * S * 0.95}" fill="${fill}" stroke="${stroke}" stroke-width="1"/>`;
const T = (y, z, s, a = 'middle', c = '#222', fs = 12) => `<text x="${Xr(y)}" y="${Yp(z)}" text-anchor="${a}" font-size="${fs}" fill="${c}">${s}</text>`;
const dimH = (y0, y1, z, s) => `<line x1="${Xr(y0)}" x2="${Xr(y1)}" y1="${Yp(z)}" y2="${Yp(z)}" stroke="#666" marker-start="url(#a)" marker-end="url(#a)"/>${T((y0 + y1) / 2, z + 0.03, s, 'middle', '#444', 11)}`;
const dimV = (y, z0, z1, s) => `<line x1="${Xr(y)}" x2="${Xr(y)}" y1="${Yp(z0)}" y2="${Yp(z1)}" stroke="#666" marker-start="url(#a)" marker-end="url(#a)"/><text x="${Xr(y) + 5}" y="${Yp((z0 + z1) / 2) + 4}" font-size="11" fill="#444">${s}</text>`;
const ear = [4.167, 1.221], kh = [5.673, 1.218];
let el = '';
el += `<line x1="${Xr(6.656)}" x2="${Xr(6.656)}" y1="${Yp(0)}" y2="${Yp(2.0)}" stroke="#999" stroke-width="3"/>` + T(6.656, 2.03, 'pared frontal', 'middle', '#777', 11);
el += `<line x1="${Xr(6.75)}" x2="${Xr(3.7)}" y1="${Yp(0)}" y2="${Yp(0)}" stroke="#999" stroke-width="2"/>`;
el += R(4.62, 5.5, 0.705, 0.73, '#c09a6b') + R(4.67, 5.45, 0, 0.705, 'none', '#c09a6b');
el += R(4.85, 5.15, 0.73, 0.78, '#e3c86a');
// pie y KH
el += R(5.523, 5.823, 0, 0.02, '#4a4a50') + R(5.643, 5.703, 0.02, 0.93, '#4a4a50') + R(5.553, 5.793, 0.93, 0.95, '#4a4a50');
el += R(5.55, 5.80, 0.977, 1.254, '#2a78d6', '#1b4f8f') + T(5.675, 1.29, 'KH 120 A', 'middle', '#1b4f8f', 11);
// pantalla (perfil aproximado, inclinada 8°)
const a = (8 * Math.PI) / 180, piv = [5.32, 0.835];
const pt = (dy, dz) => [piv[0] + dy * Math.cos(a) + dz * Math.sin(a), piv[1] + dz * Math.cos(a) - dy * Math.sin(a)];
const scr = [pt(0, 0), pt(0, 0.42), pt(0.03, 0.42), pt(0.03, 0)].map(([y, z]) => `${Xr(y)},${Yp(z)}`).join(' ');
el += `<polygon points="${scr}" fill="#3a3a3f"/>` + R(5.16, 5.49, 0.73, 0.745, '#3a3a3f') + R(5.30, 5.34, 0.745, 0.85, '#3a3a3f');
el += T(5.30, 1.31, 'pantalla (8° atrás)', 'middle', '#3a3a3f', 11);
// oyente y caminos
el += `<circle cx="${Xr(ear[0])}" cy="${Yp(ear[1])}" r="7" fill="#159a6f"/>` + T(ear[0], ear[1] + 0.05, 'oído', 'middle', '#159a6f', 11);
el += `<line x1="${Xr(kh[0])}" y1="${Yp(kh[1])}" x2="${Xr(ear[0])}" y2="${Yp(ear[1])}" stroke="#159a6f" stroke-dasharray="5 4"/>`;
// rebote en la mesa: imagen del KH bajo el plano de la lana (0,78)
const zp = 0.78, img = 2 * zp - kh[1], tt = (zp - img) / (ear[1] - img), yb = kh[0] + (ear[0] - kh[0]) * tt;
el += `<polyline points="${Xr(kh[0])},${Yp(kh[1])} ${Xr(yb)},${Yp(zp)} ${Xr(ear[0])},${Yp(ear[1])}" fill="none" stroke="#eb6834" stroke-width="1.5"/>` + T(yb - 0.42, zp + 0.17, 'rebote en la mesa → cae en la lana', 'middle', '#eb6834', 11);
el += dimH(5.5, 4.62, 0.5, '88 cm de fondo') + dimH(5.15, 4.85, 0.64, '30 cm de lana') + dimH(4.85, 4.62, 0.64, '23 cm');
el += dimV(4.45, 0, 0.73, '73 cm') + dimV(5.95, 0, 0.95, 'pie 95 cm') + dimV(4.0, 0, 1.221, 'oído 122 cm');
const elev = `<svg width="${ox + 3.05 * S + 20}" height="${oy + 20}" font-family="Inter, system-ui, sans-serif"><defs><marker id="a" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,2 L10,5 L0,8" fill="#666"/></marker></defs>${el}</svg>`;
// ── gráfica ──
const W = 520, H = 260, M = { l: 44, r: 10, t: 14, b: 30 };
const fx = (v) => M.l + (Math.log10(v / 200) / Math.log10(100)) * (W - M.l - M.r);
const fy = (d) => M.t + ((10 - d) / 25) * (H - M.t - M.b);
const chart = (title, idx) => {
	let g = `<text x="${M.l}" y="11" font-size="12" font-weight="600" fill="#222">${title}</text>`;
	for (const d of [10, 5, 0, -5, -10, -15]) g += `<line x1="${M.l}" x2="${W - M.r}" y1="${fy(d)}" y2="${fy(d)}" stroke="#e3e3e3"/><text x="${M.l - 5}" y="${fy(d) + 4}" font-size="10" text-anchor="end" fill="#777">${d}</text>`;
	for (const v of [200, 500, 1000, 2000, 5000, 10000, 20000]) g += `<line x1="${fx(v)}" x2="${fx(v)}" y1="${M.t}" y2="${H - M.b}" stroke="#eee"/><text x="${fx(v)}" y="${H - M.b + 14}" font-size="10" text-anchor="middle" fill="#777">${v >= 1000 ? v / 1000 + 'k' : v}</text>`;
	const line = (c, col, w) => `<polyline fill="none" stroke="${col}" stroke-width="${w}" points="${c.map((d, i) => `${fx(f[i]).toFixed(1)},${fy(Math.max(-15, Math.min(10, d))).toFixed(1)}`).join(' ')}"/>`;
	g += line(curves['dibujada'][idx], '#9a9a9a', 1.6) + line(curves['nueva'][idx], '#eb6834', 2);
	return `<svg width="${W}" height="${H}" font-family="Inter, system-ui, sans-serif">${g}</svg>`;
};
const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff;font-family:Inter,system-ui,sans-serif;color:#222;padding:16px;width:1100px">
<h2 style="margin:0 0 4px;font-size:18px">Mesa acústica para el Estudio v0.05</h2>
<div style="font-size:12px;color:#555;margin-bottom:8px">Alzado lateral (corte por el KH izquierdo). Ancho de la mesa: 185 cm (X de 1,13 a 2,98 m). Lana de roca 80 kg/m³, 5 cm, forrada de tela fina, a todo el ancho menos 3 cm por lado.</div>
${elev}
<div style="font-size:12px;color:#555;margin:6px 0">Respuesta en tu oído (directo + reflexiones hasta 3 rebotes, con difracción), 1/6 de octava, respecto al directo: <b style="color:#9a9a9a">tu mesa</b> y <b style="color:#eb6834">la nueva</b>.</div>
<div style="display:flex;gap:16px">${chart('KH izquierdo', 0)}${chart('KH derecho', 1)}</div></body>`;
writeFileSync('mesa/lamina.html', html);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1140, height: 800 } });
await p.goto('file://' + process.cwd() + '/mesa/lamina.html');
await p.screenshot({ path: 'mesa/Mesa_acustica.png', fullPage: true });
await b.close();
console.log('ok');
