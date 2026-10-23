// Mesas acústicas para el Estudio v0.05: genera los .dae para importar en SketchUp (Z arriba, en el
// origen del modelo, metros de SketchUp: X a lo ancho, Y hacia la pared frontal, Z arriba).
// Uso: node mesa/gen_mesas.mjs   → mesa/Mesa_con_lana.dae, Mesa_sin_lana.dae, Mesa_tres_cuerpos.dae y Mesa_util.dae
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const COLOR = {
	'Madera DM': '0.75 0.6 0.42',
	'Lana Roca 80kg_m3': '0.89 0.78 0.42',
	'Metal pie KH': '0.2 0.2 0.22',
	'Metal torre PC': '0.15 0.15 0.17',
	'Plastico teclado MIDI': '0.1 0.1 0.12'
};
const box = ([x0, y0, z0], [x1, y1, z1]) => [
	[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
	[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]
];
/** caja cuya cara de arriba (y la de abajo, si `both`) sube `rise` m desde y0 hasta y1 (tablero inclinado) */
const sloped = ([x0, y0, z0], [x1, y1, z1], rise, both = true) => {
	const c = box([x0, y0, z0], [x1, y1, z1]);
	for (const i of both ? [2, 3, 6, 7] : [6, 7]) c[i][2] += rise; // los vértices de y1
	return c;
};
/** triángulos de un sólido: de 8 vértices (orden de `box`), caras hacia fuera, o ya en triángulos ({ tris }) */
const faces = (c) => {
	if (c.tris) return c.tris;
	const q = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]];
	return q.flatMap(([a, b, d, e]) => [c[a], c[b], c[d], c[a], c[d], c[e]]);
};

/** triangulación de un polígono simple (orejas); devuelve índices de 3 en 3 */
function earcut2(pts) {
	const area = pts.reduce((a, p, i) => { const q = pts[(i + 1) % pts.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0);
	const idx = pts.map((_, i) => i);
	if (area < 0) idx.reverse();
	const out = [];
	const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
	const inside = (p, a, b, c) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
	let guard = 0;
	while (idx.length > 3 && guard++ < 10000) {
		let cut = false;
		for (let i = 0; i < idx.length; i++) {
			const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
			const a = pts[ia], b = pts[ib], c = pts[ic];
			if (cross(a, b, c) <= 1e-12) continue;
			if (idx.some((j) => j !== ia && j !== ib && j !== ic && inside(pts[j], a, b, c))) continue;
			out.push(ia, ib, ic);
			idx.splice(i, 1);
			cut = true;
			break;
		}
		if (!cut) break;
	}
	if (idx.length === 3) out.push(...idx);
	return out;
}
/** pieza de perfil `prof` ([y, z] en la vista lateral) con grosor de x0 a x1 */
function extrudeX(prof, x0, x1) {
	const t = earcut2(prof), tris = [];
	for (let i = 0; i < t.length; i += 3) {
		const [a, b, c] = [prof[t[i]], prof[t[i + 1]], prof[t[i + 2]]];
		tris.push([x1, ...a], [x1, ...b], [x1, ...c], [x0, ...a], [x0, ...c], [x0, ...b]);
	}
	for (let i = 0; i < prof.length; i++) {
		const a = prof[i], b = prof[(i + 1) % prof.length];
		tris.push([x0, ...a], [x0, ...b], [x1, ...b], [x0, ...a], [x1, ...b], [x1, ...a]);
	}
	return { tris };
}
const khStands = (G) => {
	for (const [lado, x] of [['izquierdo', 1.376], ['derecho', 2.743]]) {
		const y = 5.673;
		G(`Pie KH ${lado}`, 'Metal pie KH',
			box([x - 0.15, y - 0.15, 0], [x + 0.15, y + 0.15, 0.02]),
			box([x - 0.03, y - 0.03, 0.02], [x + 0.03, y + 0.03, 0.93]),
			box([x - 0.095, y - 0.12, 0.93], [x + 0.095, y + 0.12, 0.95]));
	}
};

function conLana(G) {
	const X0 = 1.13, X1 = 2.98, YF = 4.62, YB = 5.5, TOP = 0.73, T = 0.025;
	G('Tablero', 'Madera DM', box([X0, YF, TOP - T], [X1, YB, TOP]));
	G('Lateral izquierdo', 'Madera DM', box([X0, YF + 0.05, 0], [X0 + 0.025, YB - 0.05, TOP - T]));
	G('Lateral derecho', 'Madera DM', box([X1 - 0.025, YF + 0.05, 0], [X1, YB - 0.05, TOP - T]));
	// lana de roca 80 kg/m³, 50 mm, forrada de tela fina, de 23 a 53 cm del borde
	G('Absorbente de la mesa', 'Lana Roca 80kg_m3', box([X0 + 0.03, 4.85, TOP], [X1 - 0.03, 5.15, TOP + 0.05]));
	khStands(G);
}

function sinLana(G) {
	// franja de 32 cm para el teclado y el ratón, inclinada 10° (sube hacia los KH), sin nada detrás
	const X0 = 1.13, X1 = 2.98, YF = 4.5, D = 0.32, YB = YF + D, TOP = 0.73, T = 0.025;
	const rise = D * Math.tan((10 * Math.PI) / 180);
	G('Tablero inclinado', 'Madera DM', sloped([X0, YF, TOP - T], [X1, YB, TOP], rise));
	G('Lateral izquierdo', 'Madera DM', sloped([X0, YF + 0.02, 0], [X0 + 0.025, YB - 0.02, TOP - T], rise * (D - 0.04) / D, false));
	G('Lateral derecho', 'Madera DM', sloped([X1 - 0.025, YF + 0.02, 0], [X1, YB - 0.02, TOP - T], rise * (D - 0.04) / D, false));
	// bandeja extraíble para el teclado MIDI (105 × 30 cm) bajo el tablero, a 60 cm
	const C = (X0 + X1) / 2;
	G('Bandeja teclado MIDI', 'Madera DM', box([C - 0.525, YF + 0.02, 0.585], [C + 0.525, YF + 0.32, 0.6]));
	G('Teclado MIDI 61 teclas (ejemplo)', 'Plastico teclado MIDI', box([C - 0.475, YF + 0.045, 0.6], [C + 0.475, YF + 0.295, 0.69]));
	// la torre en el suelo, bajo el extremo izquierdo (fuera de los caminos de los KH al oído)
	G('Torre PC (ejemplo)', 'Metal torre PC', box([X0 + 0.05, 4.8, 0], [X0 + 0.25, 5.25, 0.47]));
	khStands(G);
}

function tresCuerpos(G) {
	// tu idea de tres cuerpos que se meten uno dentro de otro (con ruedas de 7 cm), rehecha con el mapa de
	// zonas sensibles: nada en la zona del punto de rebote ni cerca del camino directo
	const T = 0.02, R = 0.071; // grosor del tablero y altura de las ruedas
	const side = (name, x, y0, y1, zTop) => G(name, 'Madera DM', box([x, y0, R], [x + T, y1, zTop - T]));
	// alto: los KH, con su frontal al ras del borde (Y 5,55); 185 × 40 cm a 95 cm
	G('Alto - tablero de los KH', 'Madera DM', box([1.131, 5.55, 0.95 - T], [2.981, 5.95, 0.95]));
	side('Alto - lateral izquierdo', 1.131, 5.55, 5.95, 0.95);
	side('Alto - lateral derecho', 2.961, 5.55, 5.95, 0.95);
	G('Alto - trasera baja', 'Madera DM', box([1.151, 5.93, R], [2.961, 5.95, 0.5]));
	// medio: la pantalla y aparatos pequeños; 105 × 38 cm a 74 cm, entre los dos KH y detrás (Y 5,40)
	G('Medio - tablero', 'Madera DM', box([1.53, 5.4, 0.74 - T], [2.58, 5.78, 0.74]));
	side('Medio - lateral izquierdo', 1.53, 5.4, 5.78, 0.74);
	side('Medio - lateral derecho', 2.56, 5.4, 5.78, 0.74);
	// bajo: teclado y ratón; 96 × 28 cm a 62 cm, cerca de ti (Y 4,45)
	G('Bajo - tablero', 'Madera DM', box([1.575, 4.45, 0.62 - T], [2.535, 4.73, 0.62]));
	side('Bajo - lateral izquierdo', 1.575, 4.45, 4.73, 0.62);
	side('Bajo - lateral derecho', 2.515, 4.45, 4.73, 0.62);
}

function mesaUtil(G) {
	// en marcha: lo útil primero (instrumentos a mano, teclado debajo), con el oído a 1,10 m y los KH a esa altura
	const T = 0.02;
	// detrás: los KH (eje a 1,10 m, frontal al ras) y la pantalla entre ellos, más atrás
	G('KH - tablero', 'Madera DM', box([1.131, 5.55, 0.94 - T], [2.981, 5.95, 0.94]));
	G('KH - lateral izquierdo', 'Madera DM', box([1.131, 5.55, 0], [1.151, 5.95, 0.94 - T]));
	G('KH - lateral derecho', 'Madera DM', box([2.961, 5.55, 0], [2.981, 5.95, 0.94 - T]));
	G('KH - trasera baja', 'Madera DM', box([1.151, 5.93, 0], [2.961, 5.95, 0.5]));
	// balda de instrumentos a mano (75 cm), con una ventana de lana de roca a ras donde rebota el sonido
	// balda a 76 cm; la ventana lleva lana de 3 cm y un fondo de 4 mm: lo más bajo queda a 72,6 cm, 7,6 cm
	// por encima de la bandeja (a 65 cm) para que el teclado y el ratón pasen por debajo
	const zb = 0.76, y0 = 4.65, y1 = 5.05, wx0 = 1.3, wx1 = 2.82, wy0 = 4.72, wy1 = 5.0;
	G('Balda - marco delantero', 'Madera DM', box([1.15, y0, zb - T], [2.96, wy0, zb]));
	G('Balda - marco trasero', 'Madera DM', box([1.15, wy1, zb - T], [2.96, y1, zb]));
	G('Balda - lado izquierdo', 'Madera DM', box([1.15, wy0, zb - T], [wx0, wy1, zb]));
	G('Balda - lado derecho', 'Madera DM', box([wx1, wy0, zb - T], [2.96, wy1, zb]));
	G('Balda - ventana de lana', 'Lana Roca 80kg_m3', box([wx0, wy0, zb - 0.03], [wx1, wy1, zb]));
	G('Balda - fondo de la ventana', 'Madera DM', box([wx0, wy0, zb - 0.034], [wx1, wy1, zb - 0.03]));
	G('Balda - lateral izquierdo', 'Madera DM', box([1.15, y0, 0], [1.17, y1, zb - T]));
	G('Balda - lateral derecho', 'Madera DM', box([2.94, y0, 0], [2.96, y1, zb - T]));
	// bandeja de teclado y ratón (65 cm), con guías; se mete bajo la balda
	G('Bandeja teclado', 'Madera DM', box([1.18, 4.4, 0.65 - T], [2.93, 4.72, 0.65]));
}

const ease = (a, b, n) => Array.from({ length: n }, (_, i) => { const t = (i + 1) / (n + 1); return a + (b - a) * (0.5 - 0.5 * Math.cos(Math.PI * t)); });
/** perfil del lateral «en ala» (Y, Z de SketchUp): sube detrás hasta los KH, baja en curva hasta la balda
 *  y por delante se recoge hacia atrás hasta el suelo (la mesa parece flotar y deja sitio a las rodillas) */
export function wingProfile() {
	const prof = [[5.95, 0], [5.95, 0.94], [5.55, 0.94]];
	ease(0, 1, 7).forEach((t) => prof.push([5.55 - t * 0.42, 0.94 - t * 0.18]));
	prof.push([5.13, 0.76], [4.66, 0.76], [4.62, 0.745], [4.615, 0.72], [4.63, 0.69]);
	ease(0, 1, 7).forEach((t) => prof.push([4.63 + t * 0.4, 0.69 - t * 0.69]));
	prof.push([5.03, 0]);
	return prof;
}
/** rectángulo de esquinas redondeadas (Y, Z) */
function rounded(y0, y1, z0, z1, r, n = 6) {
	const pts = [];
	for (const [cy, cz, a0] of [[y1 - r, z0 + r, -Math.PI / 2], [y1 - r, z1 - r, 0], [y0 + r, z1 - r, Math.PI / 2], [y0 + r, z0 + r, Math.PI]])
		for (let i = 0; i <= n; i++) { const a = a0 + (i / n) * (Math.PI / 2); pts.push([cy + r * Math.cos(a), cz + r * Math.sin(a)]); }
	return pts;
}

function mesaUtilDiseno(G) {
	// la mesa útil con diseño: dos laterales «en ala» de DM doble (38 mm) que unen en una pieza los tres
	// niveles; puente plano de los KH con la pantalla colgada detrás (placa VESA fija en una aleta), balda de
	// instrumentos con una retícula de contrachapado sobre lana de roca forrada de tela, bandeja de teclado
	// de nogal y tiras LED (sin efecto acústico)
	const T = 0.02;
	const prof = wingProfile();
	for (const [lado, x] of [['izquierdo', 1.112], ['derecho', 2.96]]) G(`Lateral en ala ${lado}`, 'Madera DM', 'negro', extrudeX(prof, x, x + 0.038));
	// panel de nogal embutido en la cara de fuera de cada lateral
	G('Lateral izquierdo - panel de nogal', 'Madera DM', 'nogal', extrudeX(rounded(5.25, 5.85, 0.18, 0.7, 0.08), 1.108, 1.112));
	G('Lateral derecho - panel de nogal', 'Madera DM', 'nogal', extrudeX(rounded(5.25, 5.85, 0.18, 0.7, 0.08), 2.998, 3.002));
	// línea de luz por fuera de cada lateral, siguiendo su curva delantera (tira LED en una ranura de 6 mm)
	const front = prof.filter(([y, z]) => y < 5.1 && z > 0.02 && z < 0.75);
	for (const [lado, x] of [['izquierdo', 1.106], ['derecho', 2.998]]) {
		const segs = [];
		for (let i = 0; i + 1 < front.length; i++) {
			const [ya, za] = front[i], [yb, zb] = front[i + 1];
			const ny = -(zb - za), nz = yb - ya, l = Math.hypot(ny, nz) || 1, o = 0.03; // 3 cm hacia dentro del canto
			const q = [[ya + (o * ny) / l, za + (o * nz) / l], [yb + (o * ny) / l, zb + (o * nz) / l]];
			const w = 0.004;
			segs.push({ tris: extrudeX([[q[0][0], q[0][1] - w], [q[1][0], q[1][1] - w], [q[1][0], q[1][1] + w], [q[0][0], q[0][1] + w]], x, x + 0.006).tris });
		}
		G(`LED lateral ${lado}`, 'Metal pie KH', 'led', ...segs);
	}
	// puente de los KH a 94 cm (el KH apoyado: eje a 1,10 m, a la altura del oído), frontal al ras
	// con un recorte detrás en el centro, donde se hunde la pantalla (su centro, a 1,10 m: la altura de los ojos)
	G('Puente - tablero delantero', 'Madera DM', 'negro', box([1.15, 5.55, 0.94 - T], [2.96, 5.68, 0.94]));
	G('Puente - tablero izquierdo', 'Madera DM', 'negro', box([1.15, 5.68, 0.94 - T], [1.62, 5.95, 0.94]));
	G('Puente - tablero derecho', 'Madera DM', 'negro', box([2.5, 5.68, 0.94 - T], [2.96, 5.95, 0.94]));
	G('Puente - frente de tela', 'Lana Roca 80kg_m3', 'tela', box([1.15, 5.555, 0.1], [2.96, 5.575, 0.9]));
	// listones verticales de nogal sobre la tela (2 cm, con 1,5 cm de hueco): detrás del frontal de los KH
	const slats = [];
	for (let x = 1.17; x + 0.02 <= 2.95; x += 0.035) slats.push(box([x, 5.535, 0.1], [x + 0.02, 5.555, 0.9]));
	G('Puente - listones', 'Madera DM', 'nogal', ...slats);
	G('Puente - trasera', 'Madera DM', 'negro', box([1.15, 5.93, 0], [2.96, 5.95, 0.94 - T]));
	G('Puente - zócalo', 'Madera DM', 'zocalo', box([1.15, 5.6, 0], [2.96, 5.93, 0.1]));
	for (const [lado, x] of [['izquierdo', 1.376], ['derecho', 2.743]]) G(`Tacos KH ${lado}`, 'Metal pie KH', 'metal', box([x - 0.07, 5.6, 0.94], [x + 0.07, 5.76, 0.945]));
	// aleta para la pantalla, que sube desde la trasera: placa VESA fija (sin brazo); la pantalla, con su borde
	// de abajo a 89 cm, dentro del recorte
	G('Puente - aleta de la pantalla', 'Madera DM', 'negro', box([1.86, 5.905, 0.5], [2.26, 5.93, 1.3]));
	// balda de instrumentos a 76 cm. Retícula de listones de contrachapado de 6 mm (19 mm de alto, cada 60 mm,
	// a media madera: 81 % abierta) sobre lana de roca de 80 kg/m³; los huecos llenos de lana; todo forrado
	// de tela. Lo más bajo, a 72,6 cm: 7,6 cm por encima de la bandeja
	const zb = 0.76, y0 = 4.65, y1 = 5.05, wx0 = 1.3, wx1 = 2.82, wy0 = 4.72, wy1 = 5.0;
	G('Balda - marco delantero', 'Madera DM', 'negro', box([1.15, y0, zb - T], [2.96, wy0, zb]));
	G('Balda - marco trasero', 'Madera DM', 'negro', box([1.15, wy1, zb - T], [2.96, y1, zb]));
	G('Balda - lado izquierdo', 'Madera DM', 'negro', box([1.15, wy0, zb - T], [wx0, wy1, zb]));
	G('Balda - lado derecho', 'Madera DM', 'negro', box([wx1, wy0, zb - T], [2.96, wy1, zb]));
	G('Balda - lana bajo la retícula', 'Lana Roca 80kg_m3', 'tela', box([wx0, wy0, zb - 0.031], [wx1, wy1, zb]));
	G('Balda - fondo de la ventana', 'Madera DM', 'negro', box([wx0, wy0, zb - 0.034], [wx1, wy1, zb - 0.031]));
	const ribs = [];
	for (let x = wx0 + 0.057; x < wx1 - 0.01; x += 0.06) ribs.push(box([x, wy0, zb - 0.02], [x + 0.006, wy1, zb - 0.001]));
	for (let y = wy0 + 0.067; y < wy1 - 0.01; y += 0.06) ribs.push(box([wx0, y, zb - 0.02], [wx1, y + 0.006, zb - 0.001]));
	G('Balda - retícula de contrachapado', 'Madera DM', 'reticula', ...ribs);
	// bandeja de teclado y ratón a 65 cm, sobre guías en los laterales; entra entera bajo la balda
	G('Bandeja teclado', 'Madera DM', 'nogal', box([1.18, 4.4, 0.65 - T], [2.93, 4.72, 0.65]));
	// tiras LED: bajo el borde de la balda (sobre la bandeja), bajo el borde del puente (sobre la tela), en el
	// zócalo (contra el suelo) y detrás de la aleta (luz en la pared, detrás de la pantalla)
	G('LED balda', 'Metal pie KH', 'led', box([1.2, 4.67, zb - T - 0.006], [2.91, 4.685, zb - T]));
	G('LED puente', 'Metal pie KH', 'led', box([1.17, 5.58, 0.94 - T - 0.006], [2.94, 5.595, 0.94 - T]));
	G('LED zócalo', 'Metal pie KH', 'led', box([1.2, 5.58, 0.005], [2.91, 5.6, 0.012]));
	G('LED aleta', 'Metal pie KH', 'led', box([1.88, 5.95, 0.95], [2.24, 5.955, 1.28]));
}

// ── Mesa «Arco» ──────────────────────────────────────────────────────────────────────────────────────────
// Triángulo de 60° del análisis (graves con el sub + medios y agudos): oído en (2,05, 4,19) a 1,10 m, KH a 1,40 m
// (frontal en el radio 1,40), girados 30° hacia el oído. Todo lo que está delante es un arco centrado en el oído.
export const ARCO = { xc: 2.05, ye: 4.19, ear: 1.1, D: 1.4, half: 0.96, sub: [2.85, 5.14] };
const arcPt = (r, aDeg, A = ARCO) => { const a = (aDeg * Math.PI) / 180; return [A.xc + r * Math.sin(a), A.ye + r * Math.cos(a)]; };
/** sólido de 8 vértices (orden de `box`) entre dos polígonos de 4 vértices en planta, con alturas por vértice */
const slab = (q, zlo, zhi) => [...q.map(([x, y], i) => [x, y, typeof zlo === 'function' ? zlo(x, y) : zlo]), ...q.map(([x, y]) => [x, y, typeof zhi === 'function' ? zhi(x, y) : zhi])];
/** sector de corona (r0..r1, a0..a1) en trozos */
const sectorSolids = (r0, r1, a0, a1, zlo, zhi, step = 3) => {
	const n = Math.max(1, Math.ceil((a1 - a0) / step)), out = [];
	for (let i = 0; i < n; i++) {
		const aa = a0 + ((a1 - a0) * i) / n, ab = a0 + ((a1 - a0) * (i + 1)) / n;
		out.push(slab([arcPt(r0, aa), arcPt(r0, ab), arcPt(r1, ab), arcPt(r1, aa)], zlo, zhi));
	}
	return out;
};
/** franja entre el arco r (delante) y la recta y = yb (detrás), de x0 a x1 */
const arcLine = (r, yb, x0, x1, zlo, zhi, dx = 0.03) => {
	const A = ARCO, yf = (x) => A.ye + Math.sqrt(Math.max(0, r * r - (x - A.xc) ** 2)), n = Math.ceil((x1 - x0) / dx), out = [];
	for (let i = 0; i < n; i++) {
		const xa = x0 + ((x1 - x0) * i) / n, xb = x0 + ((x1 - x0) * (i + 1)) / n;
		out.push(slab([[xa, yf(xa)], [xb, yf(xb)], [xb, yb], [xa, yb]], zlo, zhi));
	}
	return out;
};
/** la balda: sube 8° hacia los KH (las cosas se inclinan hacia ti y su rebote va al pecho) */
export function arcoShelf(A = ARCO) {
	const c = Math.max(0.62, A.D / 2), w0 = c - 0.21, w1 = Math.min(c + 0.2, A.D - 0.3);
	return { y: 0.77, r0: w0 - 0.03, r1: w1 + 0.02, a: 52, tilt: 8, w0, w1, wa: 49, c: (w0 - 0.03 + w1 + 0.02) / 2 };
}
export function arcoWing(A = ARCO) {
	const S = arcoShelf(A), tk = Math.tan((S.tilt * Math.PI) / 180), zs = (r) => S.y + (r - S.c) * tk;
	const yB = A.ye + A.D * Math.cos(Math.PI / 6) + 0.43, top = A.ear - 0.17; // fondo: caja del KH (23 cm) y 20 cm para el pie de la pantalla
	const yBr = A.ye + Math.sqrt((A.D - 0.03) ** 2 - A.half ** 2); // canto del puente en el lateral
	const yS0 = A.ye + S.r0 * Math.cos((S.a * Math.PI) / 180), yS1 = A.ye + S.r1 * Math.cos((S.a * Math.PI) / 180);
	const zS0 = zs(S.r0), zS1 = zs(S.r1);
	// ala: banda de 12–14 cm que sigue el contorno de arriba (puente → curva → balda → morro), con un poste detrás
	const curve = ease(0, 1, 9).map((t) => [yBr - t * (yBr - yS1 - 0.02), top - t * (top - zS1)]);
	const off = 0.12; // ancho de la banda (constante)
	const topPath = [[yBr, top], ...curve, [yS1, zS1], [yS0 + 0.03, zS0 + 0.03 * Math.tan((S.tilt * Math.PI) / 180)]];
	const prof = [[yB, 0.15], [yB, top], ...topPath, [yS0, zS0], [yS0 - 0.025, zS0 - 0.012], [yS0 - 0.03, zS0 - 0.035], [yS0 - 0.015, zS0 - off + 0.01]];
	for (let i = topPath.length - 1; i >= 0; i--) { const [y, z] = topPath[i]; prof.push([i === 0 ? yB - 0.1 : y + 0.005 * i, z - off]); }
	prof.push([yB - 0.1, 0.15]);
	// pata inclinada: de debajo del morro de la balda al suelo, hacia atrás (deja libre el sitio de las piernas)
	const leg = [[yS0 + 0.06, zS0 - 0.1], [yS0 + 0.17, zS0 - 0.1], [yB - 0.32, 0.15], [yB - 0.44, 0.15]];
	return { prof, leg, yB, yBr, top, S, zs, yS0, yS1 };
}
function mesaArco(G, A = ARCO) {
	const T = 0.025, W = arcoWing(A), { yB, top, S, zs } = W, xl = A.xc - A.half, xr = A.xc + A.half, rx = 0.42;
	const rEdge = A.D - 0.03; // los KH sobresalen 3 cm del canto
	// laterales «en ala» de 38 mm, flotando a 15 cm del suelo (pasa la Roomba) sobre un pie retranqueado
	G('Lateral izquierdo (ala)', 'Madera DM', 'cuerpo', extrudeX(W.prof, xl - 0.038, xl));
	G('Lateral derecho (ala)', 'Madera DM', 'cuerpo', extrudeX(W.prof, xr, xr + 0.038));
	G('Lateral izquierdo (pata)', 'Madera DM', 'cuerpo', extrudeX(W.leg, xl - 0.038, xl));
	G('Lateral derecho (pata)', 'Madera DM', 'cuerpo', extrudeX(W.leg, xr, xr + 0.038));
	// pies retranqueados (negros): bajo el poste y bajo la pata; por lo demás, 15 cm libres hasta el suelo
	for (const [n, x] of [['izquierdo', xl - 0.029], ['derecho', xr + 0.009]]) {
		G(`Pie trasero ${n}`, 'Madera DM', 'pie', box([x, yB - 0.09, 0], [x + 0.02, yB - 0.01, 0.15]));
		G(`Pie delantero ${n}`, 'Madera DM', 'pie', box([x, yB - 0.43, 0], [x + 0.02, yB - 0.33, 0.15]));
	}
	// puente de los KH (base a 93 cm: eje a 1,10 m), canto en arco; en el centro, el rebaje curvo de la pantalla con su pie
	G('Puente - tablero izquierdo', 'Madera DM', 'cuerpo', ...arcLine(rEdge, yB, xl, A.xc - rx, top - T, top));
	G('Puente - tablero derecho', 'Madera DM', 'cuerpo', ...arcLine(rEdge, yB, A.xc + rx, xr, top - T, top));
	G('Pantalla - fondo del rebaje (pie a 78,5 cm)', 'Madera DM', 'cuerpo', ...arcLine(A.D + 0.05, yB, A.xc - rx, A.xc + rx, 0.76, 0.785));
	for (const [n, x] of [['izquierdo', A.xc - rx], ['derecho', A.xc + rx - 0.02]]) G(`Pantalla - lado ${n} del rebaje`, 'Madera DM', 'roble', box([x, A.ye + Math.sqrt((A.D + 0.05) ** 2 - rx ** 2) - 0.01, 0.785], [x + 0.02, yB, top - T]));
	G('Puente - trasera', 'Madera DM', 'cuerpo', box([xl, yB - 0.02, 0.15], [xr, yB, top - T]));
	// tacos de los KH (los pies adhesivos del manual, 3 mm)
	for (const s of [-1, 1]) {
		const a = (s * 30 * Math.PI) / 180, [fx, fy] = arcPt(A.D, s * 30), f = [-Math.sin(a), -Math.cos(a)], rr = [-f[1], f[0]];
		for (const [u, v] of [[-0.07, 0.03], [0.07, 0.03], [-0.07, 0.2], [0.07, 0.2]]) {
			const cx = fx + u * rr[0] - v * f[0], cy = fy + u * rr[1] - v * f[1];
			G(`Pie adhesivo KH ${s < 0 ? 'izquierdo' : 'derecho'}`, 'Metal pie KH', 'pie', box([cx - 0.012, cy - 0.012, top], [cx + 0.012, cy + 0.012, top + 0.003]));
		}
	}
	// frente de listones de roble sobre tela negra, retranqueado 12 cm del canto (no hace de bafle)
	const rS = rEdge + 0.12, lim = Math.asin((A.half - 0.05) / rS) * (180 / Math.PI);
	G('Frente - tela', 'Lana Roca 80kg_m3', 'tela', ...sectorSolids(rS + 0.02, rS + 0.04, -lim, lim, 0.15, top - T, 1.5));
	const sl = [];
	for (let a = -lim; a < lim; a += (0.035 / rS) * (180 / Math.PI)) sl.push(...sectorSolids(rS, rS + 0.02, a, a + (0.02 / rS) * (180 / Math.PI), 0.15, top - T, 5));
	G('Frente - listones', 'Madera DM', 'roble', ...sl);
	// balda de instrumentos: corona de ±52°, inclinada 8° hacia ti; ventana de aletas de 3 mm cada 4 cm sobre lana
	// de 3 cm (fondo de 3 mm), todo forrado de tela; brazos hasta los laterales
	const zT = (x, y) => zs(Math.hypot(x - A.xc, y - A.ye));
	const below = (d) => (x, y) => zT(x, y) - d;
	G('Balda - marco', 'Madera DM', 'roble', ...sectorSolids(S.r0, S.w0, -S.a, S.a, below(T), zT), ...sectorSolids(S.w1, S.r1, -S.a, S.a, below(T), zT),
		...sectorSolids(S.w0, S.w1, -S.a, -S.wa, below(T), zT), ...sectorSolids(S.w0, S.w1, S.wa, S.a, below(T), zT));
	G('Balda - lana', 'Lana Roca 80kg_m3', 'tela', ...sectorSolids(S.w0, S.w1, -S.wa, S.wa, below(0.031), below(0.005)));
	G('Balda - fondo de la ventana', 'Madera DM', 'cuerpo', ...sectorSolids(S.w0, S.w1, -S.wa, S.wa, below(0.034), below(0.031)));
	const fins = [];
	for (let r = S.w0 + 0.02; r + 0.003 < S.w1; r += 0.04) fins.push(...sectorSolids(r, r + 0.003, -S.wa, S.wa, below(0.031), zT));
	G('Balda - aletas de contrachapado', 'Madera DM', 'aleta', ...fins);
	G('Balda - tela acústica', 'Lana Roca 80kg_m3', 'telafina', ...sectorSolids(S.w0, S.w1, -S.wa, S.wa, zT, (x, y) => zT(x, y) + 0.001));
	for (const s of [-1, 1]) {
		const p0 = arcPt(S.r0, s * S.a), p1 = arcPt(S.r1, s * S.a), xw = s < 0 ? xl : xr;
		const q = s < 0 ? [[xw, p0[1]], p0, p1, [xw, p1[1]]] : [p0, [xw, p0[1]], [xw, p1[1]], p1];
		G(`Balda - brazo ${s < 0 ? 'izquierdo' : 'derecho'}`, 'Madera DM', 'cuerpo', slab(q, (x, y) => zs(S.r0 + ((y - p0[1]) / (p1[1] - p0[1])) * (S.r1 - S.r0)) - T, (x, y) => zs(S.r0 + ((y - p0[1]) / (p1[1] - p0[1])) * (S.r1 - S.r0))));
	}
	// bandeja de teclado y ratón a 65 cm (sale sobre guías; entra bajo la balda)
	G('Bandeja teclado', 'Madera DM', 'roble', box([A.xc - 0.55, A.ye + 0.23, 0.63], [A.xc + 0.55, A.ye + 0.55, 0.65]));
	for (const [n, x] of [['izquierda', A.xc - 0.57], ['derecha', A.xc + 0.55]]) G(`Bandeja - guía ${n}`, 'Madera DM', 'pie', box([x, A.ye + 0.45, 0.63], [x + 0.02, A.ye + 0.75, zs(S.r0) - 0.035]));
	// luz: bajo el canto del puente y de la balda, bajo los laterales (en el suelo), detrás (pared) y en el rebaje
	const ang = (x, r) => (Math.asin((x - A.xc) / r) * 180) / Math.PI;
	const band = (r0, r1, x0, x1, zlo, zhi) => sectorSolids(r0, r1, ang(x0, r0), ang(x1, r0), zlo, zhi, 2);
	G('Puente - canto de roble', 'Madera DM', 'roble', ...band(rEdge - 0.003, rEdge + 0.004, xl, A.xc - rx, top - T, top + 0.0005), ...band(rEdge - 0.003, rEdge + 0.004, A.xc + rx, xr, top - T, top + 0.0005));
	G('LED puente', 'Metal pie KH', 'led', ...band(rEdge + 0.01, rEdge + 0.025, xl + 0.03, A.xc - rx - 0.02, top - T - 0.005, top - T), ...band(rEdge + 0.01, rEdge + 0.025, A.xc + rx + 0.02, xr - 0.03, top - T - 0.005, top - T));
	G('LED balda', 'Metal pie KH', 'led', ...sectorSolids(S.r0 + 0.01, S.r0 + 0.025, -S.a + 2, S.a - 2, below(T + 0.005), below(T)));
	G('LED bajo la mesa', 'Metal pie KH', 'led', box([xl + 0.05, yB - 0.06, 0.145], [xr - 0.05, yB - 0.04, 0.15]));
	G('LED trasera', 'Metal pie KH', 'led', box([xl + 0.05, yB, top - 0.03], [xr - 0.05, yB + 0.005, top - 0.01]));
	G('LED rebaje', 'Metal pie KH', 'led', box([A.xc - rx + 0.03, yB - 0.025, 0.79], [A.xc + rx - 0.03, yB - 0.02, 0.8]));
	// el sub, donde lo pone el análisis (en el suelo; no es parte de la mesa)
	G('Sub8 (posición del análisis)', 'Metal pie KH', 'sub', box([A.sub[0] - 0.15, A.sub[1] - 0.165, 0], [A.sub[0] + 0.15, A.sub[1] + 0.165, 0.3]));
}

/** las piezas de una mesa: { name, mat (material acústico), finish (acabado, para las imágenes), tris } */
export function collect(build) {
	const groups = [];
	build((name, mat, ...solids) => {
		const finish = typeof solids[0] === 'string' ? solids.shift() : undefined;
		groups.push({ name, mat, finish, solids, tris: solids.flatMap(faces) });
	});
	return groups;
}

export function dae(build) {
	const groups = collect(build);
	const inch = (v) => (v / 0.0254).toFixed(4);
	const mats = [...new Set(groups.map((g) => g.mat))];
	let effects = '', materials = '', geoms = '', nodes = '';
	mats.forEach((m, i) => {
		effects += `<effect id="fx${i}"><profile_COMMON><technique sid="COMMON"><lambert><diffuse><color>${COLOR[m]} 1</color></diffuse></lambert></technique></profile_COMMON></effect>\n`;
		materials += `<material id="mat${i}" name="${m}"><instance_effect url="#fx${i}"/></material>\n`;
	});
	groups.forEach((g, gi) => {
		const pts = g.solids.flatMap(faces);
		const n = pts.length, mi = mats.indexOf(g.mat);
		geoms += `<geometry id="g${gi}"><mesh><source id="g${gi}-p"><float_array id="g${gi}-a" count="${n * 3}">${pts.flat().map(inch).join(' ')}</float_array><technique_common><accessor count="${n}" source="#g${gi}-a" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source><vertices id="g${gi}-v"><input semantic="POSITION" source="#g${gi}-p"/></vertices><triangles count="${n / 3}" material="m"><input offset="0" semantic="VERTEX" source="#g${gi}-v"/><p>${[...Array(n).keys()].join(' ')}</p></triangles></mesh></geometry>\n`;
		nodes += `<node id="n${gi}" name="${g.name}"><instance_geometry url="#g${gi}"><bind_material><technique_common><instance_material symbol="m" target="#mat${mi}"/></technique_common></bind_material></instance_geometry></node>\n`;
	});
	return `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
<asset><contributor><authoring_tool>Acustica3D</authoring_tool></contributor><unit meter="0.0254" name="inch"/><up_axis>Z_UP</up_axis></asset>
<library_effects>${effects}</library_effects>
<library_materials>${materials}</library_materials>
<library_geometries>${geoms}</library_geometries>
<library_visual_scenes><visual_scene id="escena"><node id="mesa" name="Mesa acustica">${nodes}</node></visual_scene></library_visual_scenes>
<scene><instance_visual_scene url="#escena"/></scene>
</COLLADA>`;
}

export { conLana, sinLana, tresCuerpos, mesaUtil, mesaUtilDiseno, mesaArco };

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	writeFileSync(new URL('./Mesa_con_lana.dae', import.meta.url), dae(conLana));
	writeFileSync(new URL('./Mesa_sin_lana.dae', import.meta.url), dae(sinLana));
	writeFileSync(new URL('./Mesa_tres_cuerpos.dae', import.meta.url), dae(tresCuerpos));
	writeFileSync(new URL('./Mesa_util.dae', import.meta.url), dae(mesaUtil));
	writeFileSync(new URL('./Mesa_util_diseno.dae', import.meta.url), dae(mesaUtilDiseno));
	writeFileSync(new URL('./Mesa_arco.dae', import.meta.url), dae(mesaArco));
	console.log('ok: mesa/Mesa_con_lana.dae, Mesa_sin_lana.dae, Mesa_tres_cuerpos.dae, Mesa_util.dae, Mesa_util_diseno.dae, Mesa_arco.dae');
}
