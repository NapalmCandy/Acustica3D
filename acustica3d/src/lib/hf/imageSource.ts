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
import { Bvh, FresnelScene, fresnelR } from './fresnel';

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
	/** lo que deja pasar la zona de Fresnel en cada octava de HF_OCTAVES (difracción; sin él, 1) */
	fres?: number[];
	/** el método de la imagen solo no lo encontraría: llega por difracción (rebote fuera de la
	 *  superficie o camino tapado) */
	soft?: boolean;
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

/** Triángulo del plano que contiene el punto (ya sobre el plano), o −1. Con `air`, solo los que dan al
 *  aire por el lado `side` del plano (+1: el de su normal). */
function triAt(tris: Float32Array, pl: Plane, p: V3, side = 0, air?: (t: number) => number): number {
	for (const t of pl.tris) {
		if (air && side && !(air(t) & (side > 0 ? 1 : 2))) continue;
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

/** direcciones para saber si un punto está dentro de un sólido (contando cortes); no alineadas con nada */
const PARITY_DIRS: V3[] = [[0.31, 0.83, 0.46], [-0.72, 0.21, 0.66], [0.55, -0.64, 0.53], [-0.27, -0.38, -0.88], [0.86, 0.12, -0.49]].map((d) => unit(d as V3));

/** Qué lados de cada triángulo dan al aire (bit 1: el de la normal del plano; bit 2: el otro): los que
 *  están en la misma región que el oído, contando cuántas veces corta la geometría un rayo desde un punto
 *  a 3 mm de cada lado y desde el oído (misma paridad = misma región; por mayoría, 4 de 5 rayos). Así la
 *  cara de abajo de un tablero no refleja lo que viene de arriba, ni la de fuera de una pared. Si la
 *  malla no está cerrada, no hay mayoría y valen los dos lados. Se calcula al usar cada triángulo. */
function airSides(tris: Float32Array, planes: Plane[], triPlane: Int32Array, bvh: Bvh, ear: V3) {
	const cache = new Uint8Array(triPlane.length); // 0: sin calcular
	const far = (P: V3, d: V3): V3 => [P[0] + 60 * d[0], P[1] + 60 * d[1], P[2] + 60 * d[2]];
	const earPar = PARITY_DIRS.map((d) => bvh.crossings(ear, far(ear, d)) % 2);
	return (t: number): number => {
		if (cache[t]) return cache[t];
		const n = planes[triPlane[t]].n, o = t * 9;
		const c: V3 = [(tris[o] + tris[o + 3] + tris[o + 6]) / 3, (tris[o + 1] + tris[o + 4] + tris[o + 7]) / 3, (tris[o + 2] + tris[o + 5] + tris[o + 8]) / 3];
		let bits = 0;
		for (const [bit, sg] of [[1, 1], [2, -1]] as const) {
			const P: V3 = [c[0] + sg * 0.003 * n[0], c[1] + sg * 0.003 * n[1], c[2] + sg * 0.003 * n[2]];
			let other = 0;
			PARITY_DIRS.forEach((d, i) => {
				if (bvh.crossings(P, far(P, d)) % 2 !== earPar[i]) other++;
			});
			if (other < 4) bits |= bit;
		}
		return (cache[t] = bits || 3);
	};
}

export interface FindOptions {
	maxOrder: number;
	/** superficie mínima de un plano para el primer rebote y para los siguientes (m²) */
	minArea1?: number;
	minAreaN?: number;
	/** difracción aproximada por zonas de Fresnel (fresnel.ts); sin ella, todo o nada */
	diffraction?: boolean;
	/** hasta qué orden se buscan caminos que solo llegan por difracción (por defecto 2: los de más
	 *  rebotes son débiles y son la mayor parte del cálculo) */
	softOrder?: number;
	/** para no calcular la difracción de caminos que no van a llegar a nada: eje de cada fuente,
	 *  absorción de cada material por octava (HF_OCTAVES) y nivel mínimo respecto al directo (dB) */
	prune?: { aim: Record<string, V3>; alpha: number[][]; minDb: number };
}

/** sin `prune`: por debajo de esto (en todas las octavas desde 500 Hz) un camino no se guarda */
const MIN_FRES_DB = -30;

/** Todos los caminos (directo y reflexiones hasta `maxOrder`) de cada fuente al oído. Con difracción
 *  (por defecto) cada camino lleva en `fres` lo que deja pasar su zona de Fresnel por octava, y se
 *  guardan también los que el método de la imagen descarta por poco (rebote fuera de la superficie o
 *  camino tapado) si por difracción llega algo. */
export function findPaths(tris: Float32Array, triMat: Int32Array, sources: { id: string; pos: V3 }[], ear: V3, o: FindOptions): Path[] {
	const { planes, triPlane } = buildPlanes(tris, triMat);
	const bvh = new Bvh(tris, triMat.length, (t) => triMat[t] >= 0, triPlane);
	const soft = o.diffraction ?? true;
	const softOrder = o.softOrder ?? 2;
	const big1 = planes.map((p, i) => (p.area >= (o.minArea1 ?? 0.002) ? i : -1)).filter((i) => i >= 0);
	const bigN = planes.map((p, i) => (p.area >= (o.minAreaN ?? 0.15) ? i : -1)).filter((i) => i >= 0);
	// caja de cada plano, para descartar rápido los rebotes que caen lejos de él
	const pbox = planes.map((pl) => {
		const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
		for (const t of pl.tris) for (let k = 0; k < 9; k++) (lo[k % 3] = Math.min(lo[k % 3], tris[t * 9 + k])), (hi[k % 3] = Math.max(hi[k % 3], tris[t * 9 + k]));
		return { lo, hi };
	});
	const boxDist = (q: number, p: V3) => {
		const { lo, hi } = pbox[q];
		return Math.hypot(Math.max(0, lo[0] - p[0], p[0] - hi[0]), Math.max(0, lo[1] - p[1], p[1] - hi[1]), Math.max(0, lo[2] - p[2], p[2] - hi[2]));
	};
	// difracción de 250 Hz a 16 kHz (por debajo, como a 250 Hz: ahí ya no vale la acústica geométrica)
	const FROM = HF_OCTAVES.indexOf(250), B500 = HF_OCTAVES.indexOf(500);
	const lam = HF_OCTAVES.slice(FROM).map((f) => C_SOUND / f);
	const NB = lam.length;
	const air = soft ? airSides(tris, planes, triPlane, bvh, ear) : undefined;
	const fz = new FresnelScene(bvh, planes, (q, p, side) => triAt(tris, planes[q], p, side, air) >= 0, lam);
	const fac = new Array<number>(NB);
	const minDb = o.prune?.minDb ?? MIN_FRES_DB;
	/** ¿llega el camino a algo en alguna octava desde 500 Hz? (`gain`: su nivel sin difracción, dB) */
	const enough = (gain: number[], f: number[]) => {
		for (let k = B500 - FROM; k < NB; k++) if (gain[k] + 20 * Math.log10(f[k] + 1e-12) >= minDb) return true;
		return false;
	};

	const out: Path[] = [];
	for (const s of sources) {
		const S = s.pos;
		const chain: number[] = [];
		const images: V3[] = [S];
		/** el camino por los planos de `chain` (vacío: el directo) */
		const tryChain = () => {
			// de atrás hacia delante: del oído a la última imagen, cortando cada plano
			const k = chain.length;
			const pts: V3[] = new Array(k);
			const inside: boolean[] = new Array(k);
			const sides: number[] = new Array(k);
			let target = ear;
			const total = len(sub(ear, images[k]));
			for (let j = k - 1; j >= 0; j--) {
				const pl = planes[chain[j]];
				const I = images[j + 1];
				const dir = sub(target, I);
				const den = dot(pl.n, dir);
				if (Math.abs(den) < 1e-12) return;
				const t = -(dot(pl.n, I) + pl.d) / den;
				if (t <= 1e-6 || t >= 1 - 1e-6) return;
				const X: V3 = [I[0] + t * dir[0], I[1] + t * dir[1], I[2] + t * dir[2]];
				// el lado del plano por el que llega (el del punto siguiente, que está en el aire)
				sides[j] = dot(pl.n, target) + pl.d > 0 ? 1 : -1;
				inside[j] = triAt(tris, pl, X, sides[j], air) >= 0;
				if (!inside[j]) {
					if (!soft || k > softOrder) return;
					// lejos del plano: ni por difracción (a más de dos zonas de Fresnel a 500 Hz de su superficie)
					const s2 = len(sub(ear, X)); // aproximado: del rebote al oído en línea recta
					if (boxDist(chain[j], X) > 2 * fresnelR(lam[B500 - FROM], Math.max(0.05, total - s2), Math.max(0.05, s2))) return;
				}
				pts[j] = X;
				target = X;
			}
			const all = [S, ...pts, ear];
			const cum: number[] = [0];
			for (let i = 0; i + 1 < all.length; i++) cum.push(cum[i] + len(sub(all[i + 1], all[i])));
			const blockedSeg = all.slice(1).map((_, i) => bvh.blocked(all[i], all[i + 1], i > 0 ? chain[i - 1] : -1, i < k ? chain[i] : -1));
			const geometric = inside.every(Boolean) && !blockedSeg.some(Boolean);
			if (!geometric && k > softOrder) return;
			const path: Path = {
				src: s.id, order: k, length: total, points: all, mats: [], leave: unit(sub(all[1], S))
			};
			if (!soft) {
				if (!geometric) return;
				// el material del triángulo donde cae el rebote
				path.mats = pts.map((X, j) => triMat[triAt(tris, planes[chain[j]], X)]);
				out.push(path);
				return;
			}
			// el material del triángulo donde cae el rebote (o del plano, si cae fuera)
			path.mats = pts.map((X, j) => {
				const t = triAt(tris, planes[chain[j]], X, sides[j], air);
				return triMat[t >= 0 ? t : planes[chain[j]].tris[0]];
			});
			// nivel sin difracción respecto al directo: directividad, distancia y absorción
			const gain = new Array<number>(NB).fill(0);
			if (o.prune) {
				const aim = o.prune.aim[s.id], dlen = len(sub(ear, S));
				for (let b = 0; b < NB; b++) {
					const f = HF_OCTAVES[FROM + b];
					gain[b] = (aim ? khDirectivityDb(path.leave, aim, f) : 0) + 20 * Math.log10(dlen / total);
					for (const m of path.mats) gain[b] += 10 * Math.log10(Math.max(1e-6, 1 - (o.prune.alpha[m]?.[FROM + b] ?? 0)));
				}
			}
			const fres = new Array<number>(NB).fill(1);
			if (!enough(gain, fres)) return;
			for (let j = 0; j < k; j++) {
				fz.coverage(chain[j], pts[j], unit(sub(pts[j], all[j])), cum[j + 1], total - cum[j + 1], fac);
				for (let b = 0; b < NB; b++) fres[b] *= fac[b];
				if (!enough(gain, fres)) return;
			}
			// primero los tramos tapados, que son los que más quitan
			const segs = blockedSeg.map((_, i) => i).sort((x, y) => Number(blockedSeg[y]) - Number(blockedSeg[x]));
			for (const i of segs) {
				const dead = (v: number[]) => !enough(gain, fres.map((x, b) => x * Math.min(1, v[b])));
				fz.visibility(all[i], all[i + 1], i > 0 ? chain[i - 1] : -1, i < k ? chain[i] : -1, cum[i], total, fac, dead);
				for (let b = 0; b < NB; b++) fres[b] *= fac[b];
				if (!enough(gain, fres)) return;
			}
			path.fres = [...new Array(FROM).fill(fres[0]), ...fres];
			path.soft = !geometric;
			out.push(path);
		};
		tryChain();
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
 *  medidas por Neumann (sumadas en dB: aproximación separable, con lo horizontal ponderado por el coseno de
 *  la elevación) y, detrás, una caída estimada. */
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
	// lo horizontal (y la caída de detrás) pesa menos cuanto más hacia arriba o hacia abajo: en la vertical
	// del altavoz el ángulo horizontal no significa nada y así no hay salto al pasar por ella
	let hdb = dirTable(KH120_DIR_H, Math.min(90, h), f);
	if (h > 90) hdb += (octInterp(REAR_DB, f) * (h - 90)) / 90;
	return hdb * Math.cos((v * Math.PI) / 180) + dirTable(v >= 0 ? KH120_DIR_UP : KH120_DIR_DOWN, Math.abs(v), f);
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
	if (p.fres) a *= octInterp(p.fres, f);
	for (const m of p.mats) a *= Math.sqrt(Math.max(0, 1 - octInterp(alpha(m), f)));
	return a;
}

export const C_SOUND = 343;
