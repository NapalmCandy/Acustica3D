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

export { conLana, sinLana, tresCuerpos, mesaUtil, mesaUtilDiseno };

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	writeFileSync(new URL('./Mesa_con_lana.dae', import.meta.url), dae(conLana));
	writeFileSync(new URL('./Mesa_sin_lana.dae', import.meta.url), dae(sinLana));
	writeFileSync(new URL('./Mesa_tres_cuerpos.dae', import.meta.url), dae(tresCuerpos));
	writeFileSync(new URL('./Mesa_util.dae', import.meta.url), dae(mesaUtil));
	writeFileSync(new URL('./Mesa_util_diseno.dae', import.meta.url), dae(mesaUtilDiseno));
	console.log('ok: mesa/Mesa_con_lana.dae, Mesa_sin_lana.dae, Mesa_tres_cuerpos.dae, Mesa_util.dae, Mesa_util_diseno.dae');
}
