// Medios y agudos (200 Hz – 20 kHz) por acústica geométrica: método de la imagen.
//
// La simulación de ondas (FDTD) no puede llegar a 20 kHz en una sala entera (harían falta cientos de
// miles de veces más celdas). Por encima de unos cientos de Hz la longitud de onda es pequeña frente a
// paredes, mesa y pantalla, y el sonido se comporta como rayos que se reflejan como en un espejo: cada
// reflexión equivale a una fuente «imagen» al otro lado de la superficie. Aquí se buscan todas las
// reflexiones hasta un orden (1 = un rebote, 2 = dos…) entre cada KH y el oído, comprobando que el
// punto de rebote cae dentro de una superficie real y que nada tapa el camino. El resto de la energía
// (la cola difusa) se suma aparte, de forma estadística.
import type { V3 } from '../sim/voxel';
import { KH120_DIR_FREQS, KH120_DIR_H, KH120_DIR_UP, KH120_DIR_DOWN } from './kh120Directivity';

export interface Plane {
	n: V3; // normal unitaria
	d: number; // n·p + d = 0
	tris: number[];
	area: number;
}

export interface Path {
	src: string; // 'khL' | 'khR'
	order: number; // 0 = directo
	length: number; // m (recorrido total)
	points: V3[]; // fuente, puntos de rebote y oído
	mats: number[]; // material de cada rebote
	leave: V3; // dirección en que sale del altavoz (para su directividad)
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => {
	const l = len(a) || 1;
	return [a[0] / l, a[1] / l, a[2] / l];
};

/** Agrupa los triángulos (con material, triMat ≥ 0) por el plano en que están. */
export function buildPlanes(tris: Float32Array, triMat: Int32Array): { planes: Plane[]; triPlane: Int32Array } {
	const map = new Map<string, number>();
	const planes: Plane[] = [];
	const triPlane = new Int32Array(triMat.length).fill(-1);
	for (let t = 0; t < triMat.length; t++) {
		if (triMat[t] < 0) continue;
		const o = t * 9;
		const a: V3 = [tris[o], tris[o + 1], tris[o + 2]];
		const e1 = sub([tris[o + 3], tris[o + 4], tris[o + 5]], a), e2 = sub([tris[o + 6], tris[o + 7], tris[o + 8]], a);
		const c: V3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
		const area2 = len(c);
		if (area2 < 1e-10) continue;
		let n = unit(c);
		// las dos caras son el mismo plano: normal con un sentido fijo
		if (n[0] + 1e-3 * n[1] + 1e-6 * n[2] < 0) n = [-n[0], -n[1], -n[2]];
		const d = -dot(n, a);
		const key = `${Math.round(n[0] * 500)}|${Math.round(n[1] * 500)}|${Math.round(n[2] * 500)}|${Math.round(d * 200)}`;
		let pi = map.get(key);
		if (pi === undefined) map.set(key, (pi = planes.push({ n, d, tris: [], area: 0 }) - 1));
		planes[pi].tris.push(t);
		planes[pi].area += area2 / 2;
		triPlane[t] = pi;
	}
	return { planes, triPlane };
}

/** Rejilla uniforme de triángulos para saber rápido qué puede tapar un segmento. */
class TriGrid {
	lo: V3;
	h: number;
	n: [number, number, number];
	cells: Map<number, number[]> = new Map();
	stamp: Int32Array;
	tick = 0;
	constructor(private tris: Float32Array, nTris: number, use: (t: number) => boolean, h = 0.3) {
		this.h = h;
		const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
		for (let t = 0; t < nTris; t++) {
			if (!use(t)) continue;
			for (let k = 0; k < 9; k++) (lo[k % 3] = Math.min(lo[k % 3], tris[t * 9 + k])), (hi[k % 3] = Math.max(hi[k % 3], tris[t * 9 + k]));
		}
		this.lo = lo.map((v) => v - 1e-3) as V3;
		this.n = [0, 1, 2].map((k) => Math.max(1, Math.ceil((hi[k] - lo[k] + 2e-3) / h))) as [number, number, number];
		this.stamp = new Int32Array(nTris);
		for (let t = 0; t < nTris; t++) {
			if (!use(t)) continue;
			const a = [0, 1, 2].map((k) => Math.min(tris[t * 9 + k], tris[t * 9 + 3 + k], tris[t * 9 + 6 + k]));
			const b = [0, 1, 2].map((k) => Math.max(tris[t * 9 + k], tris[t * 9 + 3 + k], tris[t * 9 + 6 + k]));
			const c0 = a.map((v, k) => this.cl(Math.floor((v - this.lo[k]) / h), k));
			const c1 = b.map((v, k) => this.cl(Math.floor((v - this.lo[k]) / h), k));
			for (let x = c0[0]; x <= c1[0]; x++)
				for (let y = c0[1]; y <= c1[1]; y++)
					for (let z = c0[2]; z <= c1[2]; z++) {
						const key = x + this.n[0] * (y + this.n[1] * z);
						let l = this.cells.get(key);
						if (!l) this.cells.set(key, (l = []));
						l.push(t);
					}
		}
	}
	private cl(v: number, k: number) {
		return Math.max(0, Math.min(this.n[k] - 1, v));
	}
	/** ¿Corta algún triángulo (que no sea de los planos `skip`) el segmento a→b? */
	blocked(a: V3, b: V3, skip: (t: number) => boolean): boolean {
		const T = this.tris;
		const d = sub(b, a);
		const stamp = ++this.tick;
		// recorrido de las celdas por las que pasa el segmento (Amanatides–Woo)
		const cell = [0, 1, 2].map((k) => this.cl(Math.floor((a[k] - this.lo[k]) / this.h), k));
		const end = [0, 1, 2].map((k) => this.cl(Math.floor((b[k] - this.lo[k]) / this.h), k));
		const step = d.map((v) => (v > 0 ? 1 : v < 0 ? -1 : 0));
		const tMax = [0, 1, 2].map((k) => (step[k] === 0 ? Infinity : ((this.lo[k] + (cell[k] + (step[k] > 0 ? 1 : 0)) * this.h - a[k]) / d[k])));
		const tDelta = [0, 1, 2].map((k) => (step[k] === 0 ? Infinity : this.h / Math.abs(d[k])));
		for (let guard = 0; guard < 10000; guard++) {
			const list = this.cells.get(cell[0] + this.n[0] * (cell[1] + this.n[1] * cell[2]));
			if (list)
				for (const t of list) {
					if (this.stamp[t] === stamp) continue;
					this.stamp[t] = stamp;
					if (skip(t)) continue;
					const o = t * 9;
					const e1x = T[o + 3] - T[o], e1y = T[o + 4] - T[o + 1], e1z = T[o + 5] - T[o + 2];
					const e2x = T[o + 6] - T[o], e2y = T[o + 7] - T[o + 1], e2z = T[o + 8] - T[o + 2];
					const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
					const det = e1x * px + e1y * py + e1z * pz;
					if (Math.abs(det) < 1e-12) continue;
					const sx = a[0] - T[o], sy = a[1] - T[o + 1], sz = a[2] - T[o + 2];
					const u = (sx * px + sy * py + sz * pz) / det;
					if (u < 0 || u > 1) continue;
					const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
					const v = (d[0] * qx + d[1] * qy + d[2] * qz) / det;
					if (v < 0 || u + v > 1) continue;
					const tt = (e2x * qx + e2y * qy + e2z * qz) / det;
					if (tt > 1e-4 && tt < 1 - 1e-4) return true;
				}
			if (cell[0] === end[0] && cell[1] === end[1] && cell[2] === end[2]) break;
			const k = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : tMax[1] < tMax[2] ? 1 : 2;
			if (tMax[k] > 1) break;
			cell[k] += step[k];
			tMax[k] += tDelta[k];
		}
		return false;
	}
}

/** Triángulo del plano que contiene el punto (ya sobre el plano), o −1. */
function triAt(tris: Float32Array, pl: Plane, p: V3): number {
	for (const t of pl.tris) {
		const o = t * 9;
		const a: V3 = [tris[o], tris[o + 1], tris[o + 2]];
		const v0 = sub([tris[o + 3], tris[o + 4], tris[o + 5]], a), v1 = sub([tris[o + 6], tris[o + 7], tris[o + 8]], a), v2 = sub(p, a);
		const d00 = dot(v0, v0), d01 = dot(v0, v1), d11 = dot(v1, v1), d20 = dot(v2, v0), d21 = dot(v2, v1);
		const den = d00 * d11 - d01 * d01;
		if (Math.abs(den) < 1e-14) continue;
		const v = (d11 * d20 - d01 * d21) / den, w = (d00 * d21 - d01 * d20) / den;
		if (v >= -1e-6 && w >= -1e-6 && v + w <= 1 + 1e-6) return t;
	}
	return -1;
}

export interface FindOptions {
	maxOrder: number;
	/** superficie mínima de un plano para el primer rebote y para los siguientes (m²) */
	minArea1?: number;
	minAreaN?: number;
}

/** Todos los caminos (directo y reflexiones hasta `maxOrder`) de cada fuente al oído. */
export function findPaths(tris: Float32Array, triMat: Int32Array, sources: { id: string; pos: V3 }[], ear: V3, o: FindOptions): Path[] {
	const { planes, triPlane } = buildPlanes(tris, triMat);
	const grid = new TriGrid(tris, triMat.length, (t) => triMat[t] >= 0);
	const big1 = planes.map((p, i) => (p.area >= (o.minArea1 ?? 0.002) ? i : -1)).filter((i) => i >= 0);
	const bigN = planes.map((p, i) => (p.area >= (o.minAreaN ?? 0.15) ? i : -1)).filter((i) => i >= 0);
	const out: Path[] = [];
	for (const s of sources) {
		const S = s.pos;
		out.push({ src: s.id, order: 0, length: len(sub(ear, S)), points: [S, ear], mats: [], leave: unit(sub(ear, S)) });
		const chain: number[] = [];
		const images: V3[] = [S];
		const tryChain = () => {
			// de atrás hacia delante: del oído a la última imagen, cortando cada plano
			const k = chain.length;
			const pts: V3[] = new Array(k);
			const triOf: number[] = new Array(k);
			let target = ear;
			for (let j = k - 1; j >= 0; j--) {
				const pl = planes[chain[j]];
				const I = images[j + 1];
				const dir = sub(target, I);
				const den = dot(pl.n, dir);
				if (Math.abs(den) < 1e-12) return;
				const t = -(dot(pl.n, I) + pl.d) / den;
				if (t <= 1e-6 || t >= 1 - 1e-6) return;
				const X: V3 = [I[0] + t * dir[0], I[1] + t * dir[1], I[2] + t * dir[2]];
				const tri = triAt(tris, pl, X);
				if (tri < 0) return;
				pts[j] = X;
				triOf[j] = tri;
				target = X;
			}
			const all = [S, ...pts, ear];
			for (let i = 0; i + 1 < all.length; i++) {
				const pa = i > 0 ? chain[i - 1] : -1, pb = i < k ? chain[i] : -1;
				if (grid.blocked(all[i], all[i + 1], (t) => triPlane[t] === pa || triPlane[t] === pb)) return;
			}
			out.push({ src: s.id, order: k, length: len(sub(ear, images[k])), points: all, mats: triOf.map((t) => triMat[t]), leave: unit(sub(pts[0], S)) });
		};
		const rec = (order: number) => {
			const list = order === 0 ? big1 : bigN;
			const I = images[order];
			for (const q of list) {
				if (order > 0 && q === chain[order - 1]) continue;
				const pl = planes[q];
				const sI = dot(pl.n, I) + pl.d, sE = dot(pl.n, ear) + pl.d;
				// la imagen y el oído tienen que estar del mismo lado (si no, no hay rebote en esa cara)
				if (sI * sE <= 1e-9) continue;
				chain.push(q);
				images.push([I[0] - 2 * sI * pl.n[0], I[1] - 2 * sI * pl.n[1], I[2] - 2 * sI * pl.n[2]]);
				tryChain();
				if (order + 1 < o.maxOrder) rec(order + 1);
				chain.pop();
				images.pop();
			}
		};
		if (o.maxOrder > 0) rec(0);
	}
	return out;
}

// ── de los caminos a la respuesta en el oído ──

export const HF_OCTAVES = [63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

/** Lo que baja además detrás del altavoz (de 90° a 180°), por octava: el manual solo llega a ±90°.
 *  [estimado: caja de 18 × 28 cm, casi omnidireccional en graves] */
const REAR_DB = [-1, -2.5, -5, -8, -10, -10, -10, -9, -8];

/** Nivel (dB) de una tabla de directividad del manual a un ángulo (0–90°) y una frecuencia. */
function dirTable(T: number[][], ang: number, f: number): number {
	const F = KH120_DIR_FREQS;
	const x = Math.log(Math.max(F[0], Math.min(F[F.length - 1], f)) / F[0]) / Math.log(2 ** (1 / 3));
	const i = Math.min(F.length - 2, Math.floor(x)), tf = Math.min(1, x - i);
	const a = Math.min(90, Math.max(0, ang)) / 10;
	const j = Math.min(8, Math.floor(a)), ta = a - j;
	const at = (r: number) => T[r][j] * (1 - ta) + T[r][j + 1] * ta;
	return at(i) * (1 - tf) + at(i + 1) * tf;
}

/** Directividad del KH 120 (dB respecto a su eje) en la dirección `dir` para un altavoz que apunta a
 *  `aim` y está de pie (tweeter arriba): ángulo horizontal y vertical respecto al eje, con las tablas
 *  medidas por Neumann (sumadas en dB: aproximación separable) y, detrás, una caída estimada. */
export function khDirectivityDb(dir: V3, aim: V3, f: number): number {
	const fwd = unit(aim);
	// «arriba» del altavoz: la vertical, sin la parte que va a lo largo del eje
	const k = fwd[1];
	const up = unit([-k * fwd[0], 1 - k * fwd[1], -k * fwd[2]]);
	const right: V3 = [fwd[1] * up[2] - fwd[2] * up[1], fwd[2] * up[0] - fwd[0] * up[2], fwd[0] * up[1] - fwd[1] * up[0]];
	const d = unit(dir);
	const xf = dot(d, fwd), xr = dot(d, right), xu = dot(d, up);
	const h = (Math.abs(Math.atan2(xr, xf)) * 180) / Math.PI; // 0–180
	const v = (Math.atan2(xu, Math.hypot(xf, xr)) * 180) / Math.PI; // −90 (abajo) … 90 (arriba)
	let db = dirTable(KH120_DIR_H, Math.min(90, h), f) + dirTable(v >= 0 ? KH120_DIR_UP : KH120_DIR_DOWN, Math.abs(v), f);
	if (h > 90) db += (octInterp(REAR_DB, f) * (h - 90)) / 90;
	return db;
}

/** Factor de directividad Q del KH 120 por octava (63 Hz – 16 kHz): 4π entre la integral de la
 *  potencia relativa al eje sobre toda la esfera. Para el campo difuso. */
export const KH_Q = HF_OCTAVES.map((f) => {
	let acc = 0;
	const N = 36, M = 18;
	for (let i = 0; i < N; i++)
		for (let j = 0; j < M; j++) {
			const az = ((i + 0.5) / N) * 2 * Math.PI - Math.PI, el = ((j + 0.5) / M) * Math.PI - Math.PI / 2;
			const dir: V3 = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
			acc += 10 ** (khDirectivityDb(dir, [0, 0, 1], f) / 10) * Math.cos(el) * ((2 * Math.PI) / N) * (Math.PI / M);
		}
	return (4 * Math.PI) / acc;
});
/** absorción del aire (dB/m, 20 °C, 50 % HR) por octava */
const AIR_DB_M = [0, 0.0003, 0.001, 0.002, 0.005, 0.01, 0.03, 0.09, 0.3];

/** Interpolación por octavas (en log f) de una tabla de 9 valores. */
export function octInterp(vals: number[], f: number): number {
	const x = Math.log2(f / HF_OCTAVES[0]);
	if (x <= 0) return vals[0];
	if (x >= vals.length - 1) return vals[vals.length - 1];
	const i = Math.floor(x), t = x - i;
	return vals[i] * (1 - t) + vals[i + 1] * t;
}

/** Amplitud (respecto al directo de un KH a 1 m en su eje) de un camino a la frecuencia f.
 *  `alpha(mat)`: absorción del material por octavas (9 valores, 63 Hz – 16 kHz); `aim`: eje del KH
 *  (apunta al oído, de pie). */
export function pathAmplitude(p: Path, f: number, aim: V3, alpha: (mat: number) => number[]): number {
	let a = Math.pow(10, (khDirectivityDb(p.leave, aim, f) - octInterp(AIR_DB_M, f) * p.length) / 20) / Math.max(0.05, p.length);
	for (const m of p.mats) a *= Math.sqrt(Math.max(0, 1 - octInterp(alpha(m), f)));
	return a;
}

export const C_SOUND = 343;
