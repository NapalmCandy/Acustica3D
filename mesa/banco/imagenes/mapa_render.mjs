// Lámina del mapa de zonas sensibles (alzado por el KH izquierdo y el oído + plantas a 3 alturas).
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '/home/user/acustica3d/acustica3d/node_modules/playwright/index.mjs';
const [OUT = 'mesa/Mapa_zonas_sensibles.png', DESIGN = 'dibujada', DATA = 'mapas.json'] = process.argv.slice(2);
const data = readFileSync(DATA, 'utf8');
const curves = JSON.parse(readFileSync('curves3.json', 'utf8'));
const designs = JSON.parse(readFileSync('disenos.json', 'utf8'));
const D0 = JSON.parse(data);
const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff;font-family:Inter,system-ui,sans-serif;color:#222;padding:16px;width:1180px">
<h2 style="margin:0 0 4px;font-size:18px">Zonas sensibles alrededor de los KH: dónde estorba la mesa · ${designs[DESIGN].title}</h2>
<div style="font-size:12px;color:#555;margin-bottom:8px;max-width:1150px">Cada punto: cuánto sonido manda a tu oído un <b>borde</b> de tablero que esté ahí (dB respecto al directo, media de 500 Hz a 4 kHz), por difracción del sonido directo o del rebote. En el <b>punto de rebote</b> (✕) una superficie que lo cubra refleja entera (unos 6 dB más que el color). Blanco = no molesta; rojo oscuro = molesta mucho. KH en su sitio del v0.05, a ${D0.ear[1].toFixed(2).replace('.', ',')} m, como el oído (centrado).</div>
<canvas id="sec" width="1100" height="380"></canvas>
<div id="leg" style="font-size:11px;color:#555;margin:2px 0 10px 50px"></div>
<div style="display:flex;gap:14px"><canvas id="p0" width="380" height="380"></canvas><canvas id="p1" width="380" height="380"></canvas><canvas id="p2" width="380" height="380"></canvas></div>
${designs[DESIGN].curve ? '<div style="font-size:12px;color:#555;margin:8px 0 4px">Respuesta en tu oído (directo + reflexiones hasta 3 rebotes, con difracción), 1/6 de octava, respecto al directo: <b style="color:#9a9a9a">tu diseño</b> y <b style="color:#eb6834">' + designs[DESIGN].title + '</b>.</div><div style="display:flex;gap:16px"><canvas id="c0" width="560" height="250"></canvas><canvas id="c1" width="560" height="250"></canvas></div>' : ''}
<script>
const D = ${data};
const DES = ${JSON.stringify(designs[DESIGN])};
const stops = [[-30, [247, 247, 242]], [-24, [253, 227, 167]], [-18, [249, 166, 90]], [-12, [224, 83, 58]], [-6, [140, 29, 24]]];
const plan = (i) => DES.plans[i] ?? [];
const col = (v) => { v = Math.max(-30, Math.min(-6, v)); for (let i = 0; i < stops.length - 1; i++) { const [a, ca] = stops[i], [b, cb] = stops[i + 1]; if (v <= b) { const t = (v - a) / (b - a); return ca.map((c, k) => Math.round(c + t * (cb[k] - c))); } } return stops[4][1]; };
// ── alzado: z de -6,1 a -4,1 (pared frontal a la izquierda), y de 0 a 1,25 ──
{
	const cv = document.getElementById('sec'), g = cv.getContext('2d');
	const L = 50, T = 20, W = 1000, H = 330, nz = D.sec[0].length, ny = D.sec.length;
	const X = (z) => L + ((z + 6.1) / 2.0) * W, Y = (y) => T + H - (y / 1.25) * H;
	const img = g.createImageData(W, H);
	for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
		const iz = Math.min(nz - 1, Math.floor((px / W) * nz)), iy = Math.min(ny - 1, Math.floor(((H - 1 - py) / H) * ny));
		const c = col(D.sec[iy][iz]), o = (py * W + px) * 4;
		img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
	}
	g.putImageData(img, L, T);
	g.strokeStyle = '#999'; g.lineWidth = 1; g.font = '11px Inter, sans-serif'; g.fillStyle = '#555';
	for (let y = 0; y <= 1.2001; y += 0.2) { g.fillText(y.toFixed(1).replace('.', ','), 18, Y(y) + 4); }
	for (let z = -6; z <= -4.1; z += 0.25) g.fillText((-z).toFixed(2).replace('.', ','), X(z) - 12, T + H + 14);
	g.fillText('Y (m, hacia la pared frontal) · altura (m)', L + W / 2 - 100, T + H + 30);
	// la mesa (perfil)
	g.fillStyle = 'rgba(80,60,40,0.55)'; g.strokeStyle = '#3b2a1a'; g.lineWidth = 1.5;
	for (const pol of DES.section) { g.fillStyle = pol.lana ? 'rgba(227,200,106,0.9)' : 'rgba(80,60,40,0.55)'; const pts = pol.pts ?? pol; g.beginPath(); pts.forEach(([z, y], i) => (i ? g.lineTo(X(z), Y(y)) : g.moveTo(X(z), Y(y)))); g.closePath(); g.fill(); g.stroke(); continue; g.beginPath(); pol.forEach(([z, y], i) => (i ? g.lineTo(X(z), Y(y)) : g.moveTo(X(z), Y(y)))); g.closePath(); g.fill(); g.stroke(); }
	// KH, oído, rayo directo y rebote
	const k = D.khL, e = D.ear;
	g.fillStyle = '#2a78d6'; g.fillRect(X(-5.81), Y(k[1] + 0.117), X(-5.55) - X(-5.81), Y(k[1] - 0.16) - Y(k[1] + 0.117));
	g.fillStyle = '#159a6f'; g.beginPath(); g.arc(X(e[2]), Y(e[1]), 6, 0, 7); g.fill();
	g.setLineDash([5, 4]); g.strokeStyle = '#159a6f'; g.beginPath(); g.moveTo(X(k[2]), Y(k[1])); g.lineTo(X(e[2]), Y(e[1])); g.stroke(); g.setLineDash([]);
	g.fillStyle = '#222'; g.font = '12px Inter, sans-serif';
	g.fillText('KH', X(-5.74), Y(k[1] + 0.13)); g.fillText('oído', X(e[2]) - 12, Y(e[1]) - 10);
	for (const [t, z, y] of DES.labels) g.fillText(t, X(z), Y(y));
	g.font = 'bold 12px Inter, sans-serif'; g.fillStyle = '#8c1d18';
	g.fillText('✕ punto de rebote: a mitad de camino, a cualquier altura', X(-4.92) + 6, Y(0.05));
	g.strokeStyle = '#8c1d18'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(X(-4.92), T + 20); g.lineTo(X(-4.92), T + H); g.stroke(); g.setLineDash([]);
}
// ── plantas ──
const hs = Object.keys(D.plans);
hs.forEach((h, i) => {
	const cv = document.getElementById('p' + i), g = cv.getContext('2d');
	const L = 10, T = 22, W = 360, Hh = 330, grid = D.plans[h], nz = grid.length, nx = grid[0].length;
	// x de 0,9 a 3,2 (izquierda a derecha), z de -6,1 (arriba) a -4,1 (abajo)
	const X = (x) => L + ((x - 0.9) / 2.3) * W, Z = (z) => T + ((z + 6.1) / 2.0) * Hh;
	const img = g.createImageData(W, Hh);
	for (let py = 0; py < Hh; py++) for (let px = 0; px < W; px++) {
		const iz = Math.min(nz - 1, Math.floor((py / Hh) * nz)), ix = Math.min(nx - 1, Math.floor((px / W) * nx));
		const c = col(grid[iz][ix]), o = (py * W + px) * 4;
		img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
	}
	g.putImageData(img, L, T);
	g.fillStyle = '#222'; g.font = 'bold 12px Inter, sans-serif';
	g.fillText('Planta a ' + Number(h).toFixed(2).replace('.', ',') + ' m ' + (DES.planNames[i] ?? ''), L, 14);
	g.strokeStyle = '#3b2a1a'; g.lineWidth = 2;
	for (const [x0, x1, z0, z1] of DES.plans[i] ?? []) g.strokeRect(X(x0), Z(z0), X(x1) - X(x0), Z(z1) - Z(z0));
	g.fillStyle = '#2a78d6';
	for (const k of [D.khL, D.khR]) g.fillRect(X(k[0] - 0.09), Z(-5.81), X(k[0] + 0.09) - X(k[0] - 0.09), Z(-5.55) - Z(-5.81));
	g.fillStyle = '#159a6f'; g.beginPath(); g.arc(X(D.ear[0]), Z(D.ear[2]), 5, 0, 7); g.fill();
	g.fillStyle = '#8c1d18'; g.font = 'bold 14px Inter, sans-serif';
	for (const k of [D.khL, D.khR]) g.fillText('✕', X((k[0] + D.ear[0]) / 2) - 5, Z((k[2] + D.ear[2]) / 2) + 5);
});
const CV = ${JSON.stringify(curves)};
if (DES.curve) [0, 1].forEach((idx) => {
	const cv = document.getElementById('c' + idx), g = cv.getContext('2d');
	const M = { l: 40, r: 10, t: 18, b: 26 }, W = cv.width, H = cv.height;
	const fx = (v) => M.l + (Math.log10(v / 200) / 2) * (W - M.l - M.r), fy = (d) => M.t + ((10 - d) / 25) * (H - M.t - M.b);
	g.font = '10px Inter, sans-serif'; g.fillStyle = '#777'; g.strokeStyle = '#e6e6e6';
	for (const d of [10, 5, 0, -5, -10, -15]) { g.beginPath(); g.moveTo(M.l, fy(d)); g.lineTo(W - M.r, fy(d)); g.stroke(); g.fillText(d, M.l - 22, fy(d) + 3); }
	for (const v of [200, 500, 1000, 2000, 5000, 10000, 20000]) { g.beginPath(); g.moveTo(fx(v), M.t); g.lineTo(fx(v), H - M.b); g.stroke(); g.fillText(v >= 1000 ? v / 1000 + 'k' : v, fx(v) - 8, H - M.b + 13); }
	const line = (c, col, w) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); c.forEach((d, i) => { const x = fx(CV.f[i]), y = fy(Math.max(-15, Math.min(10, d))); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); };
	line(CV.curves['dibujada'][idx], '#9a9a9a', 1.6); line(CV.curves[DES.curve][idx], '#eb6834', 2);
	g.fillStyle = '#222'; g.font = 'bold 12px Inter, sans-serif'; g.fillText(idx ? 'KH derecho' : 'KH izquierdo', M.l, 12);
});
document.getElementById('leg').innerHTML = 'Escala: ' + stops.map(([v, c]) => '<span style="display:inline-block;width:26px;height:10px;vertical-align:middle;background:rgb(' + c.join(',') + ');border:1px solid #ccc"></span> ' + v + ' dB').join(' &nbsp; ') + ' &nbsp;·&nbsp; Diseño: ' + DES.title;
</script></body>`;
writeFileSync('mapa.html', html);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1220, height: 900 } });
await p.goto('file://' + process.cwd() + '/mapa.html');
await p.screenshot({ path: OUT, fullPage: true });
await b.close();
console.log('ok', OUT);
