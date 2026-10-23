// Difracción aproximada por zonas de Fresnel para el método de la imagen.
//
// El método de la imagen es todo o nada: un rebote cuenta entero si cae dentro de la superficie y
// nada tapa el camino, y no cuenta si no. En medios eso falla con objetos del tamaño de una mesa o
// una pantalla: a 500 Hz la zona de Fresnel de un camino de 1,5 m mide unos 40 cm de radio, así que
// el sonido rodea los bordes y una pantalla pequeña apenas refleja. Aquí cada camino se pondera, por
// octava, con la integral de Fresnel–Kirchhoff sobre la parte libre de su zona de Fresnel (en cada
// tramo) o la que cae sobre la superficie (en cada rebote). Esa parte se muestrea con rayos en anillos
// alrededor del camino; la integral se hace anillo a anillo, de forma exacta si la parte libre varía
// linealmente entre anillos. Con un borde recto da la difracción de Fresnel–Kirchhoff (−6 dB en el
// borde, −14 dB a v = 1); un reflector del tamaño de la primera zona da más que uno infinito, y uno
// mucho más pequeño casi nada.
import type { V3 } from '../sim/voxel';

/** Árbol de cajas (BVH) de los triángulos, para saber rápido si algo corta un segmento. */
export class Bvh {
	private box: Float32Array; // min xyz, max xyz por nodo
	private first: Int32Array; // hoja: primer triángulo en `order`; interno: hijo izquierdo
	private count: Int32Array; // hoja: nº de triángulos; interno: 0 (el derecho es first + 1)
	private order: Int32Array;
	private stack = new Int32Array(128);
	constructor(private T: Float32Array, nTris: number, use: (t: number) => boolean, private triPlane: Int32Array) {
		const ids: number[] = [];
		for (let t = 0; t < nTris; t++) if (use(t)) ids.push(t);
		const n = Math.max(1, ids.length);
		this.order = Int32Array.from(ids);
		this.box = new Float32Array(n * 2 * 6);
		this.first = new Int32Array(n * 2);
		this.count = new Int32Array(n * 2);
		const cen = new Float32Array(nTris * 3);
		for (const t of ids) for (let k = 0; k < 3; k++) cen[t * 3 + k] = (T[t * 9 + k] + T[t * 9 + 3 + k] + T[t * 9 + 6 + k]) / 3;
		let nodes = 1;
		const build = (node: number, lo: number, hi: number) => {
			const b = this.box, o = node * 6;
			b[o] = b[o + 1] = b[o + 2] = Infinity;
			b[o + 3] = b[o + 4] = b[o + 5] = -Infinity;
			const cl = [Infinity, Infinity, Infinity], ch = [-Infinity, -Infinity, -Infinity];
			for (let i = lo; i < hi; i++) {
				const t = this.order[i];
				for (let v = 0; v < 3; v++)
					for (let k = 0; k < 3; k++) {
						const x = T[t * 9 + v * 3 + k];
						if (x < b[o + k]) b[o + k] = x;
						if (x > b[o + 3 + k]) b[o + 3 + k] = x;
					}
				for (let k = 0; k < 3; k++) (cl[k] = Math.min(cl[k], cen[t * 3 + k])), (ch[k] = Math.max(ch[k], cen[t * 3 + k]));
			}
			if (hi - lo <= 4) {
				this.first[node] = lo;
				this.count[node] = hi - lo;
				return;
			}
			const ax = ch[0] - cl[0] > ch[1] - cl[1] ? (ch[0] - cl[0] > ch[2] - cl[2] ? 0 : 2) : ch[1] - cl[1] > ch[2] - cl[2] ? 1 : 2;
			const part = this.order.subarray(lo, hi);
			part.sort((a, c) => cen[a * 3 + ax] - cen[c * 3 + ax]);
			const mid = (lo + hi) >> 1;
			const left = nodes;
			nodes += 2;
			this.first[node] = left;
			this.count[node] = 0;
			build(left, lo, mid);
			build(left + 1, mid, hi);
		};
		if (ids.length) build(0, 0, ids.length);
	}

	/** ¿Corta algún triángulo (que no sea de los planos `skipA`/`skipB`) el segmento a→b? */
	blocked(a: V3, b: V3, skipA = -1, skipB = -1): boolean {
		return this.trace(a, b, skipA, skipB, true) < 1;
	}
	/** Dónde (0–1) corta el segmento a→b el primer triángulo, o 1 si no corta ninguno. */
	firstHit(a: V3, b: V3, skipA = -1, skipB = -1): number {
		return this.trace(a, b, skipA, skipB, false);
	}
	/** Cuántas veces corta la semirrecta desde `a` en la dirección `d` (hasta `a + d`) los triángulos:
	 *  impar = `a` está dentro de un sólido cerrado. */
	crossings(a: V3, b: V3): number {
		this.count_ = 0;
		this.trace(a, b, -2, -2, false, true);
		return this.count_;
	}
	private count_ = 0;
	private trace(a: V3, b: V3, skipA: number, skipB: number, any: boolean, count = false): number {
		let best = 1;
		if (!this.order.length) return 1;
		const T = this.T, B = this.box, tp = this.triPlane;
		const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
		const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
		const st = this.stack;
		let sp = 0;
		st[sp++] = 0;
		while (sp) {
			const node = st[--sp], o = node * 6;
			// caja contra el segmento (t de 0 a 1)
			let t0 = 0, t1 = 1;
			let ta = (B[o] - a[0]) * ix, tb = (B[o + 3] - a[0]) * ix;
			if (ta > tb) { const x = ta; ta = tb; tb = x; }
			if (dx === 0) { if (a[0] < B[o] || a[0] > B[o + 3]) continue; } else { if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) continue; }
			ta = (B[o + 1] - a[1]) * iy; tb = (B[o + 4] - a[1]) * iy;
			if (ta > tb) { const x = ta; ta = tb; tb = x; }
			if (dy === 0) { if (a[1] < B[o + 1] || a[1] > B[o + 4]) continue; } else { if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) continue; }
			ta = (B[o + 2] - a[2]) * iz; tb = (B[o + 5] - a[2]) * iz;
			if (ta > tb) { const x = ta; ta = tb; tb = x; }
			if (dz === 0) { if (a[2] < B[o + 2] || a[2] > B[o + 5]) continue; } else { if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) continue; }
			if (t0 >= best && !count) continue;
			const cnt = this.count[node];
			if (!cnt) {
				st[sp++] = this.first[node];
				st[sp++] = this.first[node] + 1;
				continue;
			}
			for (let i = this.first[node], e = i + cnt; i < e; i++) {
				const t = this.order[i];
				if (tp[t] === skipA || tp[t] === skipB) continue;
				const p = t * 9;
				const e1x = T[p + 3] - T[p], e1y = T[p + 4] - T[p + 1], e1z = T[p + 5] - T[p + 2];
				const e2x = T[p + 6] - T[p], e2y = T[p + 7] - T[p + 1], e2z = T[p + 8] - T[p + 2];
				const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
				const det = e1x * px + e1y * py + e1z * pz;
				if (Math.abs(det) < 1e-12) continue;
				const sx = a[0] - T[p], sy = a[1] - T[p + 1], sz = a[2] - T[p + 2];
				const u = (sx * px + sy * py + sz * pz) / det;
				if (u < 0 || u > 1) continue;
				const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
				const v = (dx * qx + dy * qy + dz * qz) / det;
				if (v < 0 || u + v > 1) continue;
				const tt = (e2x * qx + e2y * qy + e2z * qz) / det;
				if (count) {
					if (tt > 1e-6 && tt < 1) this.count_++;
					continue;
				}
				if (tt > 1e-4 && tt < 1 - 1e-4 && tt < best) {
					if (any) return tt;
					best = tt;
				}
			}
		}
		return best;
	}
}

// ── la zona de Fresnel ──

/** radios de los anillos de muestras (m) y direcciones por anillo; entre dos anillos con distinto
 *  resultado se busca por bisección el radio exacto del borde */
export const RINGS = [0.02, 0.04, 0.08, 0.16, 0.32, 0.64, 1.28, 2.56];
export const DIRS = 8;
const BISECT = 4;
const DIR_CS: [number, number][] = Array.from({ length: DIRS }, (_, j) => {
	const a = ((j + 0.5) / DIRS) * 2 * Math.PI; // medio paso: ningún borde por el centro cae justo en una dirección
	return [Math.cos(a), Math.sin(a)];
});

/** La abertura alrededor del camino: si el centro está libre y, en cada dirección, los radios donde
 *  cambia (libre ↔ tapado). */
export interface Aperture { center: boolean; edges: number[][] }

/** Busca la abertura con `probe(r, c, s)` (¿está libre el punto a distancia r en la dirección (c, s)?). */
export function aperture(probe: (r: number, c: number, s: number) => boolean): Aperture {
	const center = probe(0, 1, 0);
	const edges: number[][] = [];
	for (const [c, s] of DIR_CS) {
		const e: number[] = [];
		let prev = center, lo = 0;
		for (const R of RINGS) {
			const st = probe(R, c, s);
			if (st !== prev) {
				let a = lo, b = R;
				for (let i = 0; i < BISECT; i++) {
					const m = a === 0 ? b / 2 : Math.sqrt(a * b);
					if (probe(m, c, s) === prev) a = m;
					else b = m;
				}
				e.push(a === 0 ? b / 2 : Math.sqrt(a * b));
				prev = st;
			}
			lo = R;
		}
		edges.push(e);
	}
	return { center, edges };
}

const NSUB = 8;
const STEP = (2 * Math.PI) / DIRS;
const DIR_A = Array.from({ length: DIRS }, (_, j) => (j + 0.5) * STEP);

/** Radio, en el ángulo θ, de la recta que pasa por el borde i de las direcciones ja y jb (Infinity si
 *  el rayo no la corta). */
function lineAt(ap: Aperture, ja: number, jb: number, i: number, th: number): number {
	const ra = ap.edges[ja][i], rb = ap.edges[jb][i];
	const xa = ra * Math.cos(DIR_A[ja]), ya = ra * Math.sin(DIR_A[ja]), xb = rb * Math.cos(DIR_A[jb]), yb = rb * Math.sin(DIR_A[jb]);
	const c = Math.cos(th), sn = Math.sin(th);
	const dx = xb - xa, dy = yb - ya;
	const den = c * dy - sn * dx;
	if (Math.abs(den) < 1e-12) return Infinity;
	const t = (xa * dy - ya * dx) / den;
	return t > 0 ? t : Infinity;
}

/** Radio del borde i en el ángulo θ (entre las direcciones j y j+1): la recta que une los dos puntos
 *  encontrados; si solo una de las dos lo tiene, la recta que viene del sector de al lado (que se aleja
 *  hasta el infinito si el borde sale del sector). Exacto para un borde recto. */
function edgeAt(ap: Aperture, j: number, th: number, i: number): number {
	const j2 = (j + 1) % DIRS;
	const n1 = ap.edges[j].length, n2 = ap.edges[j2].length;
	if (i < n1 && i < n2) return lineAt(ap, j, j2, i, th);
	if (i >= n1 && i >= n2) return Infinity;
	// solo una de las dos direcciones tiene este borde: se sigue la recta del sector vecino
	const [has, other] = i < n1 ? [j, (j - 1 + DIRS) % DIRS] : [j2, (j2 + 1) % DIRS];
	if (i < ap.edges[other].length) return lineAt(ap, other, has, i, th);
	// sin vecino: el borde a la mitad del sector
	return Math.abs(th - DIR_A[has]) < STEP / 2 || Math.abs(th - DIR_A[has] - 2 * Math.PI) < STEP / 2 ? ap.edges[has][i] : Infinity;
}

/** Amplitud (respecto a sin obstáculos) que deja pasar la abertura para una zona de Fresnel de radio
 *  `r`: integral de Fresnel–Kirchhoff (1/2π)∫dθ ∫ (jπ/r²)·e^(−jπρ²/r²)·2ρ dρ sobre lo libre. En cada
 *  ángulo, cada tramo libre [a, b] aporta e^(−jπa²/r²) − e^(−jπb²/r²); el ángulo se integra en NSUB
 *  pasos por sector con el borde interpolado como recta. Más allá del último anillo, como en él. */
export function apertureAmp(ap: Aperture, r: number): number {
	const k = Math.PI / (r * r);
	let re = 0, im = 0;
	const add = (a: number, b: number) => {
		re += Math.cos(k * a * a) - (b === Infinity ? 0 : Math.cos(k * b * b));
		im += -Math.sin(k * a * a) + (b === Infinity ? 0 : Math.sin(k * b * b));
	};
	for (let j = 0; j < DIRS; j++) {
		const n = Math.max(ap.edges[j].length, ap.edges[(j + 1) % DIRS].length);
		for (let q = 0; q < NSUB; q++) {
			const th = DIR_A[j] + ((q + 0.5) / NSUB) * STEP;
			let open = ap.center, from = 0;
			for (let i = 0; i < n; i++) {
				const x = Math.max(from, edgeAt(ap, j, th, i));
				if (x === Infinity) break;
				if (open) add(from, x);
				(open = !open), (from = x);
			}
			if (open) add(from, Infinity);
		}
	}
	return Math.hypot(re, im) / (DIRS * NSUB);
}

/** radio de la primera zona de Fresnel a distancias s1 y s2 de los extremos, para una longitud de onda */
export const fresnelR = (lambda: number, s1: number, s2: number) => Math.sqrt((lambda * s1 * s2) / Math.max(1e-6, s1 + s2));

/** Base ortonormal (u, v) perpendicular a `d` (unitario). */
export function perp(d: V3): [V3, V3] {
	const a: V3 = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
	let u: V3 = [d[1] * a[2] - d[2] * a[1], d[2] * a[0] - d[0] * a[2], d[0] * a[1] - d[1] * a[0]];
	const l = Math.hypot(u[0], u[1], u[2]);
	u = [u[0] / l, u[1] / l, u[2] / l];
	const v: V3 = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
	return [u, v];
}

export interface FresnelPlane { n: V3; d: number }

/** tramos en que se parte cada segmento: cada trozo mira lo que tapa su zona de Fresnel cerca de él */
const WINDOWS = 4;

/** Difracción de los caminos de una escena: lo que deja pasar cada tramo y lo que refleja cada rebote. */
export class FresnelScene {
	constructor(
		private bvh: Bvh,
		private planes: FresnelPlane[],
		/** ¿cae el punto (ya sobre el plano q) dentro de su superficie, por el lado `side` (+1: el de la
		 *  normal del plano, −1: el otro)? */
		private inPlane: (q: number, p: V3, side: number) => boolean,
		/** longitudes de onda de las octavas que se calculan */
		private lambdas: number[]
	) {}

	private side(q: number, p: V3) {
		const pl = this.planes[q];
		return pl.n[0] * p[0] + pl.n[1] * p[1] + pl.n[2] * p[2] + pl.d;
	}
	private mirror(q: number, p: V3): V3 {
		const pl = this.planes[q], s = this.side(q, p);
		return [p[0] - 2 * s * pl.n[0], p[1] - 2 * s * pl.n[1], p[2] - 2 * s * pl.n[2]];
	}

	/** Amplitud reflejada por el plano q en X (llegando en la dirección u, a s1 de la fuente por el
	 *  camino y a s2 del oído): la parte de la zona de Fresnel que cae sobre la superficie. */
	coverage(q: number, X: V3, u: V3, s1: number, s2: number, out: number[]) {
		const pl = this.planes[q], [e1, e2] = perp(u);
		const nu = pl.n[0] * u[0] + pl.n[1] * u[1] + pl.n[2] * u[2];
		const side = nu < 0 ? 1 : -1; // llega desde el lado al que apunta la normal si va contra ella
		const ap = aperture((r, c, sn) => {
			const Q: V3 = [X[0] + r * (c * e1[0] + sn * e2[0]), X[1] + r * (c * e1[1] + sn * e2[1]), X[2] + r * (c * e1[2] + sn * e2[2])];
			// al plano, a lo largo del rayo
			const k = Math.abs(nu) < 1e-9 ? 0 : -this.side(q, Q) / nu;
			return this.inPlane(q, [Q[0] + k * u[0], Q[1] + k * u[1], Q[2] + k * u[2]], side);
		});
		for (let b = 0; b < this.lambdas.length; b++) out[b] = Math.min(2, apertureAmp(ap, fresnelR(this.lambdas[b], s1, s2)));
	}

	/** Amplitud que deja pasar el tramo a→b (a s0 de la fuente por el camino, que mide `total`). El
	 *  tramo se parte en trozos y en cada uno se prueban caminos desplazados alrededor (quebrados en el
	 *  centro del trozo y que vuelven al camino en a y en b, como los de la zona de Fresnel), mirando
	 *  solo lo que hay en ese trozo; cuenta el trozo más tapado. `qa`/`qb`: planos del rebote en cada
	 *  extremo (no tapan, y lo que queda detrás de ellos se refleja: es el mismo camino desplegado). */
	visibility(a: V3, b: V3, qa: number, qb: number, s0: number, total: number, out: number[], stop?: (v: number[]) => boolean) {
		out.fill(1);
		const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
		const L = Math.hypot(d[0], d[1], d[2]);
		const [e1, e2] = perp([d[0] / L, d[1] / L, d[2] / L]);
		const at = (t: number, disp: number, c: number, sn: number): V3 => {
			let p: V3 = [
				a[0] + t * d[0] + disp * (c * e1[0] + sn * e2[0]),
				a[1] + t * d[1] + disp * (c * e1[1] + sn * e2[1]),
				a[2] + t * d[2] + disp * (c * e1[2] + sn * e2[2])
			];
			if (qa >= 0 && this.side(qa, p) * this.side(qa, b) < 0) p = this.mirror(qa, p);
			if (qb >= 0 && this.side(qb, p) * this.side(qb, a) < 0) p = this.mirror(qb, p);
			return p;
		};
		// primero el trozo donde está lo que tapa el camino (si algo lo tapa): suele bastar para descartarlo
		const hit = this.bvh.firstHit(a, b, qa, qb);
		const first = hit < 1 ? Math.min(WINDOWS - 1, Math.floor(hit * WINDOWS)) : 0;
		for (let n = 0; n < WINDOWS; n++) {
			const w = (first + n) % WINDOWS;
			const t0 = w / WINDOWS, t1 = (w + 1) / WINDOWS, tc = (t0 + t1) / 2;
			const ap = aperture((r, c, sn) => {
				const A = at(t0, (r * t0) / tc, c, sn), Q = at(tc, r, c, sn), B = at(t1, (r * (1 - t1)) / (1 - tc), c, sn);
				return !this.bvh.blocked(A, Q, qa, qb) && !this.bvh.blocked(Q, B, qa, qb);
			});
			if (ap.center && ap.edges.every((e) => !e.length)) continue; // libre del todo
			const s1 = s0 + tc * L;
			for (let k = 0; k < this.lambdas.length; k++) out[k] = Math.min(out[k], apertureAmp(ap, fresnelR(this.lambdas[k], s1, total - s1)));
			if (stop?.(out)) return;
		}
		for (let k = 0; k < out.length; k++) out[k] = Math.min(1, out[k]);
	}
}
