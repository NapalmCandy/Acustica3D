// Tratamiento acústico en la colocación automática: dónde poner las trampas de esquina y los paneles.
//
// - Paneles planos: en los puntos de primera reflexión de los KH hacia la cabeza (paredes laterales y
//   techo). Es geometría (método de la imagen), no hace falta simular: en graves apenas cambian nada y en
//   medios y agudos es donde quitan las reflexiones que emborronan la imagen estéreo.
// - Trampas de esquina: se prueban en «huecos» posibles (esquinas verticales y aristas pared-techo y
//   pared-suelo), copiando la forma de colocarlas que se ve en el dibujo. Cada distribución cambia la
//   sala, así que hay que volver a simular; el worker elige qué distribuciones probar.
import { objectTris, type RoomObject } from '../geometry/objects';
import type { V3 } from './voxel';

export interface Bounds {
	lo: V3;
	hi: V3;
}

/** Distancia desde `o` en la dirección `d` hasta el primer triángulo, o Infinity. */
export function rayHit(P: ArrayLike<number>, nTris: number, o: V3, d: V3, maxT = Infinity): number {
	let best = Infinity;
	for (let t = 0; t < nTris; t++) {
		const i = t * 9;
		const e1x = P[i + 3] - P[i], e1y = P[i + 4] - P[i + 1], e1z = P[i + 5] - P[i + 2];
		const e2x = P[i + 6] - P[i], e2y = P[i + 7] - P[i + 1], e2z = P[i + 8] - P[i + 2];
		const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
		const det = e1x * px + e1y * py + e1z * pz;
		if (Math.abs(det) < 1e-12) continue;
		const sx = o[0] - P[i], sy = o[1] - P[i + 1], sz = o[2] - P[i + 2];
		const u = (sx * px + sy * py + sz * pz) / det;
		if (u < 0 || u > 1) continue;
		const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
		const v = (d[0] * qx + d[1] * qy + d[2] * qz) / det;
		if (v < 0 || u + v > 1) continue;
		const tt = (e2x * qx + e2y * qy + e2z * qz) / det;
		if (tt > 1e-6 && tt < best && tt < maxT) best = tt;
	}
	return best;
}

/** Caja interior de la sala vista desde `from` (lanzando rayos por los seis ejes contra la geometría fija). */
export function roomBounds(P: ArrayLike<number>, nTris: number, from: V3): Bounds | null {
	const lo: V3 = [0, 0, 0], hi: V3 = [0, 0, 0];
	for (let k = 0; k < 3; k++) {
		const d: V3 = [0, 0, 0];
		d[k] = 1;
		const up = rayHit(P, nTris, from, d);
		d[k] = -1;
		const dn = rayHit(P, nTris, from, d);
		if (!Number.isFinite(up) || !Number.isFinite(dn)) return null;
		hi[k] = from[k] + up;
		lo[k] = from[k] - dn;
	}
	return { lo, hi };
}

/** Caja envolvente (en la escena) de un objeto girado. */
export function objectAabb(o: RoomObject): Bounds {
	const t = objectTris(o).positions;
	const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i < t.length; i++) {
		const k = i % 3;
		lo[k] = Math.min(lo[k], t[i]);
		hi[k] = Math.max(hi[k], t[i]);
	}
	return { lo, hi };
}

const overlaps = (a: Bounds, b: Bounds, tol = 0.02) => [0, 1, 2].every((k) => a.lo[k] < b.hi[k] - tol && b.lo[k] < a.hi[k] - tol);

/** Lo bastante inclinado (ni 0° ni 90°) como para ir en diagonal en una esquina. */
const diagonal = (deg: number) => Math.abs((((deg % 90) + 90) % 90) - 45) < 40;
export const isCornerTrap = (o: RoomObject) => diagonal(o.rotY) || diagonal(o.rotX ?? 0);
const isFlatPanel = (o: RoomObject) => !isCornerTrap(o) && Math.min(...o.size) < 0.2;

/** Hueco posible para una trampa: su postura (centro, giros y orden de las medidas: una trampa vertical
 *  y una tumbada a lo largo de una arista son la misma pieza con los ejes cambiados). */
export interface Slot {
	pos: V3;
	size: V3;
	/** la pieza que va en ese hueco (forma dibujada, si la hay): la de la trampa que ya está ahí o, en los
	 *  huecos nuevos, la de referencia girada. Las trampas son iguales, así que cualquiera puede ir. */
	mesh?: number[];
	meshSize?: V3;
	rotY: number;
	rotX: number;
	kind: 'esquina' | 'techo' | 'suelo';
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Huecos para trampas de esquina en una sala rectangular (`b`), a partir de cómo están puestas en el
 *  dibujo: las verticales, giradas para encajar en las cuatro esquinas y a todas las alturas; las
 *  horizontales, a lo largo de las aristas pared-techo y pared-suelo. Solo giros (nunca reflejos): la
 *  pieza dibujada se mueve entera, tal cual. Incluye siempre las posturas actuales. `traps` son
 *  trampas iguales. */
export function trapSlots(traps: RoomObject[], b: Bounds): Slot[] {
	const out: Slot[] = [];
	const boxes: Bounds[] = [];
	// los huecos nuevos no pueden pisar los de las trampas que ya están (ni otros huecos ya puestos)
	const add = (s: Slot, current = false) => {
		const bb = objectAabb(atSlot(traps[0], s));
		if (out.some((o) => Math.hypot(o.pos[0] - s.pos[0], o.pos[1] - s.pos[1], o.pos[2] - s.pos[2]) < 0.05)) return;
		if (!current && boxes.some((o) => overlaps(o, bb))) return;
		out.push({ ...s, pos: s.pos.map(r3) as V3 });
		boxes.push(bb);
	};
	for (const t of traps) add({ pos: t.pos, size: t.size, mesh: t.mesh, meshSize: t.meshSize, rotY: t.rotY, rotX: t.rotX ?? 0, kind: diagonal(t.rotX ?? 0) ? (t.pos[1] > (b.lo[1] + b.hi[1]) / 2 ? 'techo' : 'suelo') : 'esquina' }, true);
	const H = b.hi[1] - b.lo[1];
	const norm = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
	const ang = (n: [number, number]) => (Math.atan2(n[0], n[1]) * 180) / Math.PI;
	// giro en Y de la escena (como objectTris): (x, z) → (x·cos + z·sin, −x·sin + z·cos)
	const rotXZ = ([x, z]: [number, number], deg: number): [number, number] => {
		const a = (deg * Math.PI) / 180;
		return [x * Math.cos(a) + z * Math.sin(a), -x * Math.sin(a) + z * Math.cos(a)];
	};
	const vert = traps.find((t) => diagonal(t.rotY) && !diagonal(t.rotX ?? 0));
	if (vert) {
		// la misma pieza, girada en vertical para que encaje en cada esquina (en todas las alturas)
		const cx0 = vert.pos[0] - b.lo[0] < b.hi[0] - vert.pos[0] ? b.lo[0] : b.hi[0];
		const cz0 = vert.pos[2] - b.lo[2] < b.hi[2] - vert.pos[2] ? b.lo[2] : b.hi[2];
		const in0: [number, number] = [cx0 === b.lo[0] ? 1 : -1, cz0 === b.lo[2] ? 1 : -1];
		const v: [number, number] = [vert.pos[0] - cx0, vert.pos[2] - cz0];
		const h = vert.size[1];
		const levels = Math.max(1, Math.floor((H + 0.02) / h));
		for (const cx of [b.lo[0], b.hi[0]])
			for (const cz of [b.lo[2], b.hi[2]]) {
				const in1: [number, number] = [cx === b.lo[0] ? 1 : -1, cz === b.lo[2] ? 1 : -1];
				const d = [0, 90, 180, 270].find((g) => {
					const r = rotXZ(in0, g);
					return Math.abs(r[0] - in1[0]) < 1e-6 && Math.abs(r[1] - in1[1]) < 1e-6;
				})!;
				const off = rotXZ(v, d);
				for (let l = 0; l < levels; l++)
					add({ pos: [cx + off[0], b.lo[1] + h / 2 + l * h, cz + off[1]], size: vert.size, mesh: vert.mesh, meshSize: vert.meshSize, rotY: norm(vert.rotY + d), rotX: 0, kind: 'esquina' });
			}
	}
	const horiz = traps.find((t) => diagonal(t.rotX ?? 0));
	if (horiz) {
		// pared en la que está apoyada (la más cercana) y su normal hacia dentro
		const dists = [horiz.pos[0] - b.lo[0], b.hi[0] - horiz.pos[0], horiz.pos[2] - b.lo[2], b.hi[2] - horiz.pos[2]];
		const w0 = dists.indexOf(Math.min(...dists));
		const normalOf = (w: number): [number, number] => [[1, 0], [-1, 0], [0, 1], [0, -1]][w] as [number, number];
		const dWall = dists[w0];
		const ceil0 = b.hi[1] - horiz.pos[1] < horiz.pos[1] - b.lo[1];
		const dV = ceil0 ? b.hi[1] - horiz.pos[1] : horiz.pos[1] - b.lo[1];
		const len = horiz.size[0];
		const n0 = normalOf(w0);
		for (const ceiling of [true, false])
			for (let w = 0; w < 4; w++) {
				const wallAxis = w < 2 ? 0 : 2, along = wallAxis === 0 ? 2 : 0;
				const L = b.hi[along] - b.lo[along];
				// deja libres las esquinas (unos 50 cm) y reparte las que quepan, centradas
				const n = Math.floor((L - 1.0) / len);
				if (n < 1) continue;
				const n1 = normalOf(w);
				// la misma pieza girada: de pared a pared en vertical y, de techo a suelo, media vuelta sobre su eje largo
				let rotY: number, rotX: number;
				if (ceiling === ceil0) (rotY = horiz.rotY + ang(n1) - ang(n0)), (rotX = horiz.rotX ?? 0);
				else (rotY = ang(n1) - ang([n0[0], -n0[1]]) - horiz.rotY), (rotX = (horiz.rotX ?? 0) + 180);
				for (let i = 0; i < n; i++) {
					const pos: V3 = [0, ceiling ? b.hi[1] - dV : b.lo[1] + dV, 0];
					pos[along] = b.lo[along] + L / 2 + (i - (n - 1) / 2) * len;
					pos[wallAxis] = w % 2 === 0 ? b.lo[wallAxis] + dWall : b.hi[wallAxis] - dWall;
					add({ pos, size: horiz.size, mesh: horiz.mesh, meshSize: horiz.meshSize, rotY: norm(rotY), rotX: norm(rotX), kind: ceiling ? 'techo' : 'suelo' });
				}
			}
	}
	return out;
}

/** La trampa `t` puesta en el hueco `s`. */
export function atSlot(t: RoomObject, s: Slot): RoomObject {
	const o: RoomObject = { ...t, pos: [...s.pos] as V3, size: [...s.size] as V3, rotY: s.rotY };
	if (s.mesh) (o.mesh = s.mesh), (o.meshSize = s.meshSize);
	else delete o.mesh, delete o.meshSize;
	if (s.rotX) o.rotX = s.rotX;
	else delete o.rotX;
	return o;
}

/** ¿Choca el objeto con alguno de los otros? */
export function collides(o: RoomObject, others: RoomObject[]): boolean {
	const a = objectAabb(o);
	return others.some((x) => x.id !== o.id && overlaps(a, objectAabb(x)));
}

/** Punto de primera reflexión en el plano `axis = c` de la onda que va de S a E. */
function reflection(S: V3, E: V3, axis: number, c: number): V3 | null {
	const Em = [...E] as V3;
	Em[axis] = 2 * c - E[axis];
	const den = Em[axis] - S[axis];
	if (Math.abs(den) < 1e-9) return null;
	const t = (c - S[axis]) / den;
	if (t <= 0 || t >= 1) return null;
	return [S[0] + t * (Em[0] - S[0]), S[1] + t * (Em[1] - S[1]), S[2] + t * (Em[2] - S[2])];
}

/** Paneles planos en los puntos de primera reflexión de una colocación: los de pared, a las paredes
 *  laterales (primero la reflexión del KH de cada lado en su pared, después las cruzadas); los de techo,
 *  entre las reflexiones de los dos KH en el techo. Conservan su cámara de aire. Si un panel no cabe
 *  sin chocar con otro objeto, se queda donde estaba. */
export function placePanels(objects: RoomObject[], cfg: { listener: V3; khL: V3; khR: V3; facing: number }, b: Bounds): RoomObject[] {
	const out = objects.map((o) => ({ ...o, pos: [...o.pos] as V3 }));
	const thinAxis = (o: RoomObject) => o.size.indexOf(Math.min(...o.size));
	const flats = out.filter(isFlatPanel);
	const wall = flats.filter((o) => thinAxis(o) !== 1 || (o.rotX && diagonal(o.rotX)));
	const ceil = flats.filter((o) => thinAxis(o) === 1 && !o.rotX);
	// paredes laterales: perpendiculares a la derecha del oyente
	const f = ((Math.round(cfg.facing / 90) % 4) + 4) % 4;
	const sideAxis = f % 2 === 0 ? 0 : 2;
	const a = (cfg.facing * Math.PI) / 180;
	const right = [-(-Math.cos(a)), Math.sin(a)]; // derecha = (−uz, ux) con u = (sin, −cos)
	const rightIsHi = (sideAxis === 0 ? right[0] : right[1]) > 0;
	const leftWall = rightIsHi ? b.lo[sideAxis] : b.hi[sideAxis];
	const rightWall = rightIsHi ? b.hi[sideAxis] : b.lo[sideAxis];
	const E = cfg.listener;
	const targets: { wallC: number; p: V3 | null }[] = [
		{ wallC: leftWall, p: reflection(cfg.khL, E, sideAxis, leftWall) },
		{ wallC: rightWall, p: reflection(cfg.khR, E, sideAxis, rightWall) },
		{ wallC: leftWall, p: reflection(cfg.khR, E, sideAxis, leftWall) },
		{ wallC: rightWall, p: reflection(cfg.khL, E, sideAxis, rightWall) }
	];
	const clampIn = (o: RoomObject) => {
		const bb = objectAabb(o);
		for (let k = 0; k < 3; k++) {
			if (bb.lo[k] < b.lo[k]) o.pos[k] += b.lo[k] - bb.lo[k];
			else if (bb.hi[k] > b.hi[k]) o.pos[k] -= bb.hi[k] - b.hi[k];
		}
	};
	const tryPlace = (o: RoomObject, pos: V3, rotY: number) => {
		const old = { pos: o.pos, rotY: o.rotY };
		o.pos = pos;
		o.rotY = rotY;
		clampIn(o);
		if (collides(o, out)) Object.assign(o, old);
	};
	wall.forEach((o, i) => {
		const t = targets[i % targets.length];
		if (!t.p) return;
		const gap = (o.porous?.airgap_mm ?? 0) / 1000;
		const th = Math.min(...o.size);
		const pos = [...t.p] as V3;
		pos[sideAxis] = t.wallC + Math.sign((b.lo[sideAxis] + b.hi[sideAxis]) / 2 - t.wallC) * (gap + th / 2);
		// la cara fina mirando a la pared: el eje fino local (X o Z) a lo largo del eje de la pared
		const thinLocal = thinAxis(o) === 0 ? 0 : 2;
		const rotY = (sideAxis === 0) === (thinLocal === 0) ? 0 : 90;
		tryPlace(o, pos, rotY);
	});
	const cl = reflection(cfg.khL, E, 1, b.hi[1]), cr = reflection(cfg.khR, E, 1, b.hi[1]);
	if (cl && cr)
		ceil.forEach((o, i) => {
			const gap = (o.porous?.airgap_mm ?? 0) / 1000;
			const th = Math.min(...o.size);
			// el primero entre las dos reflexiones; si hay más, en cada una
			const p = i === 0 ? [(cl[0] + cr[0]) / 2, 0, (cl[2] + cr[2]) / 2] : i === 1 ? cl : cr;
			// el lado largo a lo ancho (de un KH al otro)
			const longLocal = o.size[0] >= o.size[2] ? 0 : 2;
			const rotY = (sideAxis === 0) === (longLocal === 0) ? 0 : 90;
			tryPlace(o, [p[0], b.hi[1] - gap - th / 2, p[2]], rotY);
		});
	return out;
}
