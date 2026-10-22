// Reconocimiento de lo que hay dibujado en un .skp, a partir de sus grupos y materiales:
//
// - Altavoces dibujados (KH, Neumann…): se quitan de la geometría (en la simulación son fuentes puntuales)
//   y sus posiciones pasan a ser las de los KH izquierdo y derecho.
// - Persona (oyente) y silla: se quitan; la cabeza pasa a ser la posición de escucha.
// - Trampas de graves y paneles de lana de roca sueltos dentro de la sala: pasan a ser objetos de la app
//   (se pueden mover a mano o con la colocación automática), con su grosor y su cámara de aire.
// - Paredes y techos por capas (pladur, lana, ladrillo, forjado…): la simulación de graves solo ve la
//   superficie que da al aire, así que a esa superficie se le pone el material acústico que corresponde
//   a lo que tiene detrás (trasdosado con lana, con cámara vacía, falso techo con plénum…).
import type { NamedTris } from '../sim/testgeo';
import type { V3 } from '../sim/voxel';
import type { SkpPart } from './skp';
import type { RoomObject } from './objects';
import { porousProduct } from '../acoustics/materials';

export interface SceneInfo {
	tris: NamedTris;
	objects: RoomObject[];
	devices: Partial<Record<'khL' | 'khR' | 'listener' | 'sub', V3>>;
	/** material (nombre nuevo) → material de la biblioteca */
	libHints: Record<string, string>;
	notes: string[];
}

const SPEAKER = /neumann|genelec|kh ?(80|120|150|310)|altavoz|speaker|studio ?monitor|monitor de estudio/i;
const PERSON = /oyente|persona|person|human|listener|cabeza|eyeball/i;
const EYE = /eyeball|ojo/i;
const DRIVER = /rejilla|grill|woofer|tweeter|cono|cone|driver/i;
const CHAIR = /silla|chair|taburete|stool/i;
const SCREEN = /monitor ?pc|pantalla|screen|samsung|televis|\btv\b/i;
const SCREEN_MAT = 'Pantalla del ordenador';
const POROUS = /lana|rockwool|sonorock|absorb|fibra|panel|trampa|bass ?trap/i;
const BOARD = /pladur|yeso|drywall|gypsum|placa|escayola/i;

type Box = { lo: V3; hi: V3 };
const emptyBox = (): Box => ({ lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] });
const grow = (b: Box, P: number[], t: number) => {
	for (let k = 0; k < 9; k++) {
		const v = P[t * 9 + k], a = k % 3;
		if (v < b.lo[a]) b.lo[a] = v;
		if (v > b.hi[a]) b.hi[a] = v;
	}
};
const size = (b: Box): V3 => [b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2]];
const center = (b: Box): V3 => [(b.lo[0] + b.hi[0]) / 2, (b.lo[1] + b.hi[1]) / 2, (b.lo[2] + b.hi[2]) / 2];
const touch = (a: Box, b: Box, tol: number) => [0, 1, 2].every((k) => a.lo[k] <= b.hi[k] + tol && b.lo[k] <= a.hi[k] + tol);
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Giro alrededor de Y (−45°…45°) con el que la planta de unos triángulos ocupa la caja más pequeña. */
function yawOf(P: number[], tris: number[]): number {
	let best = 0, bestArea = Infinity;
	for (let deg = -45; deg < 45; deg++) {
		const a = (deg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
		let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
		for (const t of tris)
			for (let k = 0; k < 3; k++) {
				const x = P[t * 9 + 3 * k], z = P[t * 9 + 3 * k + 2];
				const lx = x * ca - z * sa, lz = x * sa + z * ca;
				x0 = Math.min(x0, lx); x1 = Math.max(x1, lx); z0 = Math.min(z0, lz); z1 = Math.max(z1, lz);
			}
		const area = (x1 - x0) * (z1 - z0);
		if (area < bestArea - 1e-9) (bestArea = area), (best = deg);
	}
	return best;
}

/** Caja orientada que envuelve unos triángulos: giro `yaw` alrededor de Y y, si se pide `tilt`, además
 *  la inclinación alrededor del eje X local que la hace más ajustada (paneles en diagonal entre pared y
 *  techo). Los ejes locales son los de objectTris: primero la inclinación en X y después el giro en Y. */
function orientedBox(P: number[], tris: number[], yaw: number, tilt = false): { size: V3; pos: V3; rotX: number } {
	const a = (yaw * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
	// a ejes del giro en Y (inversa de objectTris: x' = x·cos − z·sin, z' = x·sin + z·cos)
	const pts: V3[] = [];
	for (const t of tris) for (let k = 0; k < 3; k++) {
		const x = P[t * 9 + 3 * k], y = P[t * 9 + 3 * k + 1], z = P[t * 9 + 3 * k + 2];
		pts.push([x * ca - z * sa, y, x * sa + z * ca]);
	}
	const fit = (deg: number) => {
		const b = (deg * Math.PI) / 180, cb = Math.cos(b), sb = Math.sin(b);
		const box = emptyBox();
		for (const [x, y, z] of pts) {
			// inversa de la inclinación en X: y' = y·cos + z·sin, z' = −y·sin + z·cos
			const L: V3 = [x, y * cb + z * sb, -y * sb + z * cb];
			for (let i = 0; i < 3; i++) (box.lo[i] = Math.min(box.lo[i], L[i])), (box.hi[i] = Math.max(box.hi[i], L[i]));
		}
		return box;
	};
	let rotX = 0, box = fit(0);
	if (tilt) {
		const area = (b: Box) => (b.hi[1] - b.lo[1]) * (b.hi[2] - b.lo[2]);
		let bestDeg = 0, best = box;
		for (let deg = -45; deg < 45; deg += 0.5) {
			const b = fit(deg);
			if (area(b) < area(best)) (bestDeg = deg), (best = b);
		}
		if (area(best) < 0.7 * area(box)) (rotX = bestDeg), (box = best);
	}
	const c = center(box);
	const b = (rotX * Math.PI) / 180, cb = Math.cos(b), sb = Math.sin(b);
	const y = c[1] * cb - c[2] * sb, z = c[1] * sb + c[2] * cb;
	// centro de vuelta a la escena
	return { size: size(box), pos: [c[0] * ca + z * sa, y, -c[0] * sa + z * ca], rotX };
}

/** Distancia desde `o` en la dirección `d` hasta el primer triángulo (Möller–Trumbore), o Infinity. */
function rayHit(P: number[], tris: Iterable<number>, o: V3, d: V3, maxT: number): number {
	let best = Infinity;
	for (const t of tris) {
		const i = t * 9;
		const e1 = [P[i + 3] - P[i], P[i + 4] - P[i + 1], P[i + 5] - P[i + 2]];
		const e2 = [P[i + 6] - P[i], P[i + 7] - P[i + 1], P[i + 8] - P[i + 2]];
		const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
		const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
		if (Math.abs(det) < 1e-12) continue;
		const s = [o[0] - P[i], o[1] - P[i + 1], o[2] - P[i + 2]];
		const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) / det;
		if (u < 0 || u > 1) continue;
		const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
		const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / det;
		if (v < 0 || u + v > 1) continue;
		const tt = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
		if (tt > 1e-6 && tt < best && tt < maxT) best = tt;
	}
	return best;
}

export function analyzeScene(tris: NamedTris, parts: SkpPart[], triPart: Int32Array): SceneInfo {
	const P = tris.positions;
	const nT = tris.materials.length;
	const notes: string[] = [];
	const libHints: Record<string, string> = {};
	const devices: SceneInfo['devices'] = {};
	const objects: RoomObject[] = [];
	const removed = new Uint8Array(nT);
	const newMat = tris.materials.slice();

	// grupos: nombres de sus antepasados (para reconocer «Silla Estudio», «KH120 izq»…) y triángulos
	const chain = (p: number) => {
		const out: number[] = [];
		for (let q = p; q >= 0; q = parts[q].parent) out.push(q);
		return out;
	};
	const partTris: number[][] = parts.map(() => []);
	for (let t = 0; t < nT; t++) for (const q of chain(triPart[t])) partTris[q].push(t);
	const namesOf = (t: number) => chain(triPart[t]).map((q) => parts[q].name).join(' / ');
	const flag = (t: number, re: RegExp) => re.test(tris.materials[t]) || re.test(namesOf(t));

	// ── altavoces: triángulos agrupados por cercanía (cada altavoz es un bloque compacto) ──
	const spk: number[] = [];
	for (let t = 0; t < nT; t++) if (flag(t, SPEAKER)) spk.push(t);
	const leafBoxes = new Map<number, { box: Box; tris: number[] }>();
	for (const t of spk) {
		const key = triPart[t] >= 0 ? triPart[t] : -1 - t; // sueltos en la raíz: uno por triángulo
		let e = leafBoxes.get(key);
		if (!e) leafBoxes.set(key, (e = { box: emptyBox(), tris: [] }));
		grow(e.box, P, t);
		e.tris.push(t);
	}
	const items = [...leafBoxes.values()];
	const root = items.map((_, i) => i);
	const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])));
	for (let i = 0; i < items.length; i++)
		for (let j = 0; j < i; j++) if (touch(items[i].box, items[j].box, 0.03)) root[find(i)] = find(j);
	const clusters = new Map<number, Box>();
	const clusterTris = new Map<Box, number[]>();
	for (let i = 0; i < items.length; i++) {
		const r = find(i);
		let b = clusters.get(r);
		if (!b) clusters.set(r, (b = emptyBox())), clusterTris.set(b, []);
		for (const t of items[i].tris) grow(b, P, t);
		clusterTris.get(b)!.push(...items[i].tris);
		for (const t of items[i].tris) removed[t] = 1;
	}
	/** Altura del eje acústico: el punto medio entre el tweeter y el woofer, sacado de las rejillas o los
	 *  conos dibujados (dos grupos de alturas separados por un hueco); si no, el de un KH 120 A
	 *  (12,5 cm por debajo de lo más alto de la caja). */
	const axisHeight = (b: Box): number => {
		const ys = (clusterTris.get(b) ?? [])
			.filter((t) => DRIVER.test(tris.materials[t]))
			.map((t) => (P[t * 9 + 1] + P[t * 9 + 4] + P[t * 9 + 7]) / 3)
			.sort((x, y) => x - y);
		if (ys.length >= 4) {
			let gap = 0, at = -1;
			for (let i = 1; i < ys.length; i++) if (ys[i] - ys[i - 1] > gap) (gap = ys[i] - ys[i - 1]), (at = i);
			if (gap > 0.02) {
				const lo = ys.slice(0, at), hi = ys.slice(at);
				const mid = (a: number[]) => (a[0] + a[a.length - 1]) / 2;
				return (mid(lo) + mid(hi)) / 2;
			}
		}
		return b.hi[1] - 0.125;
	};
	const speakers = [...clusters.values()].filter((b) => Math.max(...size(b)) < 1.0 && Math.max(...size(b)) > 0.1);

	// ── oyente: la persona (y la silla en la que está) ──
	const person: number[] = [], eyes: number[] = [];
	for (let t = 0; t < nT; t++) {
		if (flag(t, PERSON)) person.push(t);
		if (EYE.test(tris.materials[t])) eyes.push(t);
	}
	let listener: V3 | null = null;
	if (person.length) {
		const pb = emptyBox();
		for (const t of person) grow(pb, P, t);
		const eb = emptyBox();
		for (const t of eyes) grow(eb, P, t);
		// el oído: 5 cm por debajo de los ojos (o 17 cm por debajo de lo más alto de la persona); más
		// abajo se lleva también unos 8 cm hacia atrás
		const c = eyes.length ? ([center(eb)[0], eb.lo[1] - 0.05 + (eb.hi[1] - eb.lo[1]) / 2, center(eb)[2]] as V3) : ([(pb.lo[0] + pb.hi[0]) / 2, pb.hi[1] - 0.17, (pb.lo[2] + pb.hi[2]) / 2] as V3);
		listener = c;
		// el grupo más pequeño que contiene a toda la persona (suele llevar también la silla)
		let holder = -1;
		for (const q of chain(triPart[person[0]])) {
			const all = new Set(partTris[q]);
			if (person.every((t) => all.has(t))) {
				const b = emptyBox();
				for (const t of partTris[q]) grow(b, P, t);
				if (Math.max(...size(b)) <= 2.0) holder = q;
				break;
			}
		}
		for (const t of holder >= 0 ? partTris[holder] : person) removed[t] = 1;
	}
	// la pantalla se queda (en medios y agudos refleja mucho) con un material propio, duro y reflectante
	let screens = 0;
	for (let t = 0; t < nT; t++) {
		if (!removed[t] && flag(t, CHAIR)) removed[t] = 1;
		if (!removed[t] && flag(t, SCREEN)) (newMat[t] = SCREEN_MAT), screens++;
	}
	if (screens) {
		libHints[SCREEN_MAT] = 'pantalla';
		notes.push(`La pantalla del ordenador se queda como «${SCREEN_MAT}» (superficie dura y reflectante): en graves apenas cuenta, pero sí en medios y agudos.`);
	}

	// izquierdo / derecho según hacia dónde mira el oyente (hacia el punto medio de los altavoces)
	if (speakers.length >= 2) {
		const byDist = speakers.map((b) => ({ b, c: center(b) }));
		// los dos más cercanos a la cabeza
		if (listener) byDist.sort((a, b) => Math.hypot(a.c[0] - listener![0], a.c[2] - listener![2]) - Math.hypot(b.c[0] - listener![0], b.c[2] - listener![2]));
		const pair = [byDist[0], byDist[1]];
		const pc = pair.map((p) => p.c);
		const ref = listener ?? ([(pc[0][0] + pc[1][0]) / 2, 0, (pc[0][2] + pc[1][2]) / 2 + 1] as V3);
		const mid = [(pc[0][0] + pc[1][0]) / 2, (pc[0][2] + pc[1][2]) / 2];
		const fx = mid[0] - ref[0], fz = mid[1] - ref[2];
		const rx = -fz, rz = fx; // derecha del oyente (como en khPair)
		const isRight = (p: V3) => (p[0] - ref[0]) * rx + (p[2] - ref[2]) * rz > 0;
		const [a, b] = isRight(pair[0].c) ? [pair[1], pair[0]] : pair;
		// centro acústico del KH 120 A: el woofer, ~18 cm por debajo de lo más alto de la caja
		const acoustic = (p: { b: Box; c: V3 }): V3 => [r3(p.c[0]), r3(axisHeight(p.b)), r3(p.c[2])];
		devices.khL = acoustic(a);
		devices.khR = acoustic(b);
		if (listener) {
			// las orejas quedan unos 8 cm por detrás de los ojos
			const d = Math.hypot(fx, fz) || 1;
			listener = [listener[0] - (0.08 * fx) / d, listener[1], listener[2] - (0.08 * fz) / d];
		}
		notes.push(`Los altavoces dibujados (${speakers.length}) se han quitado de la geometría: en la simulación son fuentes. Sus posiciones son las de los KH, a la altura del punto medio entre tweeter y woofer.`);
	}
	if (listener) {
		devices.listener = [r3(listener[0]), r3(listener[1]), r3(listener[2])];
		notes.push('La persona y la silla dibujadas se han quitado de la geometría; tu oído (5 cm por debajo y 8 cm por detrás de los ojos) es la posición de escucha.');
	}

	// ── trampas y paneles de lana sueltos: grupos enteros de material poroso y tamaño de mueble ──
	const isPorous = (t: number) => POROUS.test(tris.materials[t]);
	const taken = new Uint8Array(nT);
	let nTrap = 0, nPanel = 0;
	const usedProducts = new Set<string>();
	const absorberTris: number[][] = [];
	for (let q = 0; q < parts.length; q++) {
		const ts = partTris[q];
		if (!ts.length || ts.some((t) => removed[t] || taken[t] || !isPorous(t))) continue;
		const par = parts[q].parent;
		// solo el grupo más grande que siga siendo «un objeto de lana» (no la capa de una pared)
		const yaw = yawOf(P, ts);
		const ob = orientedBox(P, ts, yaw);
		const dims = [...ob.size].sort((x, y) => x - y);
		if (dims[2] > 2.2 || dims[2] < 0.2 || dims[0] > 0.6) continue;
		if (par >= 0) {
			const pts = partTris[par];
			if (pts.every((t) => isPorous(t) && !removed[t])) {
				const pb = orientedBox(P, pts, yawOf(P, pts));
				if (Math.max(...pb.size) <= 2.2) continue; // lo coge el grupo de fuera
			}
		}
		for (const t of ts) taken[t] = 1;
		absorberTris.push(ts);
		// eje largo en X local, para poder inclinarlo sobre él
		let yawL = ob.size[2] > ob.size[0] ? yaw + 90 : yaw;
		if (yawL > 135) yawL -= 180;
		const fin = orientedBox(P, ts, yawL, true);
		// en diagonal (girado o inclinado lejos de 0°/90°): trampa de esquina; si no, panel plano
		const diag = (d: number) => Math.abs(((d % 90) + 90) % 90 - 45) < 40;
		const corner = diag(yawL) || diag(fin.rotX);
		const prod = porousProduct(tris.materials[ts[0]]);
		if (prod) usedProducts.add(prod.name);
		objects.push({
			id: `skp-${q}`,
			name: corner ? `Trampa de esquina ${++nTrap}` : `Panel ${++nPanel}`,
			libId: 'panel_lana_roca',
			porous: { thickness_mm: Math.round(Math.min(...fin.size) * 1000), density_kgm3: prod?.density_kgm3 ?? 40, airgap_mm: 0, ...(prod ? { flowRes: prod.flowRes } : {}) },
			size: fin.size.map(r3) as V3,
			pos: fin.pos.map(r3) as V3,
			rotY: yawL,
			...(fin.rotX ? { rotX: fin.rotX } : {}),
			// la forma tal cual la dibujaste, en ejes locales (se mueve y gira entera)
			mesh: toLocal(P, ts, fin.pos, yawL, fin.rotX),
			meshSize: fin.size.map(r3) as V3
		});
	}
	for (const ts of absorberTris) for (const t of ts) removed[t] = 1;
	// cámara de aire detrás de cada panel: hasta la superficie más cercana por su cara fina
	const solid: number[] = [];
	for (let t = 0; t < nT; t++) if (!removed[t]) solid.push(t);
	for (const o of objects) {
		const thin = o.size.indexOf(Math.min(...o.size));
		// eje fino del objeto en la escena: el local con la inclinación en X y el giro en Y
		const loc: V3 = [0, 0, 0];
		loc[thin] = 1;
		const d = rotate(loc, o.rotY, o.rotX ?? 0);
		const half = o.size[thin] / 2;
		const gap = Math.min(...[d, d.map((v) => -v) as V3].map((dd) => rayHit(P, solid, o.pos, dd, 0.5) - half));
		if (Number.isFinite(gap) && gap > 0.01) o.porous!.airgap_mm = Math.round(gap * 1000);
	}
	if (objects.length)
		notes.push(
			`${nTrap ? `${nTrap} trampas de esquina` : ''}${nTrap && nPanel ? ' y ' : ''}${nPanel ? `${nPanel} paneles` : ''} de lana pasan a ser objetos que se pueden mover (lista «Objetos»), con su grosor y su cámara de aire. ` +
				(usedProducts.size ? `Lana: ${[...usedProducts].join(', ')} (por el nombre del material).` : 'Densidad supuesta: 40 kg/m³; revísala si la tuya es otra.')
		);

	// ── paredes y techos por capas ──
	// capas: grupos planos de un solo material, alineados con los ejes
	type Slab = { q: number; tris: number[]; box: Box; axis: number; mat: string };
	const slabs: Slab[] = [];
	for (let q = 0; q < parts.length; q++) {
		const ts = partTris[q].filter((t) => !removed[t]);
		if (ts.length !== partTris[q].length || !ts.length) continue;
		const mat = tris.materials[ts[0]];
		if (ts.some((t) => tris.materials[t] !== mat)) continue;
		const b = emptyBox();
		for (const t of ts) grow(b, P, t);
		const s = size(b);
		const axis = s.indexOf(Math.min(...s));
		// las paredes y techos, hasta 40 cm de grueso; el suelo o un forjado, hasta 1 m
		if (s[axis] > (axis === 1 ? 1.0 : 0.4) || s.filter((v, k) => k !== axis).some((v) => v < 0.8)) continue;
		// el grupo exterior si es la misma capa (no repetir)
		slabs.push({ q, tris: ts, box: b, axis, mat });
	}
	const unique = slabs.filter((s) => !slabs.some((o) => o !== s && o.tris.length > s.tris.length && s.tris.every((t) => o.tris.includes(t))));
	const inside: V3 = devices.listener ?? center(emptyBoxOf(P, solid));
	const overlap = (a: Box, b: Box, axis: number) => {
		let area = 1;
		for (let k = 0; k < 3; k++) if (k !== axis) area *= Math.max(0, Math.min(a.hi[k], b.hi[k]) - Math.max(a.lo[k], b.lo[k]));
		return area;
	};
	const planeArea = (a: Box, axis: number) => [0, 1, 2].filter((k) => k !== axis).reduce((m, k) => m * (a.hi[k] - a.lo[k]), 1);
	let floorY: number | null = null;
	const described = new Map<string, string>();
	for (const s of unique) {
		const ax = s.axis;
		const side = Math.sign(inside[ax] - (s.box.lo[ax] + s.box.hi[ax]) / 2) || 1;
		const face = side > 0 ? s.box.hi[ax] : s.box.lo[ax];
		const dist = (o: Slab) => side * (face - (side > 0 ? o.box.hi[ax] : o.box.lo[ax]));
		const near = unique.filter((o) => o !== s && o.axis === ax && overlap(o.box, s.box, ax) > 0.3 * Math.min(planeArea(o.box, ax), planeArea(s.box, ax)));
		// tapada por otra capa más hacia dentro: no da al aire de la sala
		if (near.some((o) => dist(o) < 0 && dist(o) > -0.6)) continue;
		const behind = near.filter((o) => dist(o) > 0 && dist(o) < 0.6).sort((a, b) => dist(a) - dist(b));
		const thick = s.box.hi[ax] - s.box.lo[ax];
		const back = face - side * thick; // cara de detrás de la capa vista
		const gapTo = (o: Slab) => side * (back - (side > 0 ? o.box.hi[ax] : o.box.lo[ax]));
		const wool = behind.some((o) => POROUS.test(o.mat));
		const cavity = behind.length ? gapTo(behind[0]) : 0;
		let libId: string | null = null, what = '';
		if (ax === 1 && side < 0) {
			// techo
			if (BOARD.test(s.mat) && behind.length) {
				libId = 'falso_techo_pladur';
				what = `falso techo${cavity > 0.05 ? ` con plénum de ${Math.round(Math.max(...behind.map(gapTo)) * 100)} cm` : ''}${wool ? ' y lana' : ''}`;
			}
		} else if (ax === 1) {
			floorY = floorY === null ? face : Math.max(floorY, face);
		} else if (BOARD.test(s.mat)) {
			if (wool) (libId = 'pladur_trasdosado'), (what = 'pared con lana');
			else if (cavity > 0.01) (libId = 'pladur_camara'), (what = `pared con cámara de ${Math.round(cavity * 100)} cm sin lana`);
			else (libId = 'ladrillo'), (what = 'pared sin cámara');
		}
		if (!libId) continue;
		const name = `${s.mat} (${what})`;
		for (const t of s.tris) newMat[t] = name;
		libHints[name] = libId;
		described.set(name, [s.mat, ...behind.map((o) => o.mat)].join(' + '));
	}
	for (const [n, layers] of described) notes.push(`«${n}»: ${layers}.`);

	if (devices.khL && floorY !== null) devices.sub = [devices.khL[0], r3(floorY + 0.2), devices.khL[2]];

	const out: NamedTris = { positions: [], materials: [] };
	for (let t = 0; t < nT; t++) {
		if (removed[t]) continue;
		for (let k = 0; k < 9; k++) out.positions.push(P[t * 9 + k]);
		out.materials.push(newMat[t]);
	}
	return { tris: out, objects, devices, libHints, notes };
}

/** Triángulos de la escena a ejes locales de un objeto (inversa de objectTris: deshace el giro en Y y
 *  después la inclinación en X). */
function toLocal(P: number[], tris: number[], pos: V3, rotY: number, rotX: number): number[] {
	const a = (rotY * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
	const b = (rotX * Math.PI) / 180, cb = Math.cos(b), sb = Math.sin(b);
	const out: number[] = [];
	for (const t of tris)
		for (let k = 0; k < 3; k++) {
			const X = P[t * 9 + 3 * k] - pos[0], Y = P[t * 9 + 3 * k + 1] - pos[1], Z = P[t * 9 + 3 * k + 2] - pos[2];
			const x = X * ca - Z * sa, z1 = X * sa + Z * ca;
			out.push(Math.round(x * 1e4) / 1e4, Math.round((Y * cb + z1 * sb) * 1e4) / 1e4, Math.round((-Y * sb + z1 * cb) * 1e4) / 1e4);
		}
	return out;
}

/** Vector de ejes locales a la escena (inclinación en X y después giro en Y, como objectTris). */
function rotate([x, y0, z0]: V3, rotY: number, rotX: number): V3 {
	const b = (rotX * Math.PI) / 180, a = (rotY * Math.PI) / 180;
	const y = y0 * Math.cos(b) - z0 * Math.sin(b), z = y0 * Math.sin(b) + z0 * Math.cos(b);
	return [x * Math.cos(a) + z * Math.sin(a), y, -x * Math.sin(a) + z * Math.cos(a)];
}

function emptyBoxOf(P: number[], tris: number[]): Box {
	const b = emptyBox();
	for (const t of tris) grow(b, P, t);
	return b;
}
