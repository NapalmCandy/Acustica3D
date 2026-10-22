// Discretización de la geometría (triángulos) en una rejilla cúbica para la simulación de ondas.
// Coordenadas en metros, Y hacia arriba (convención de Three.js).

export type V3 = [number, number, number];

export interface Geometry {
	/** 9 floats por triángulo (a, b, c) */
	tris: Float32Array;
	/** índice de material por triángulo (-1 = ignorar) */
	triMat: Int32Array;
}

export interface Grid {
	nx: number;
	ny: number;
	nz: number;
	dx: number;
	origin: V3;
	/** 0 = aire de la sala, 1 = sólido / exterior */
	solid: Uint8Array;
	/** celdas de aire alcanzadas desde la semilla */
	air: Uint8Array;
	leak: boolean;
	leakPoint: V3 | null;
	airCells: number;
	airVolume: number;
	/** triángulos candidatos por celda sólida de superficie */
	cellTris: Map<number, number[]>;
}

export const idx = (g: { nx: number; ny: number }, x: number, y: number, z: number) => x + g.nx * (y + g.ny * z);

export function cellOf(g: Pick<Grid, 'origin' | 'dx'>, p: V3): V3 {
	return [
		Math.floor((p[0] - g.origin[0]) / g.dx),
		Math.floor((p[1] - g.origin[1]) / g.dx),
		Math.floor((p[2] - g.origin[2]) / g.dx)
	];
}

export function cellCenter(g: Pick<Grid, 'origin' | 'dx'>, x: number, y: number, z: number): V3 {
	return [g.origin[0] + (x + 0.5) * g.dx, g.origin[1] + (y + 0.5) * g.dx, g.origin[2] + (z + 0.5) * g.dx];
}

/** `seed`: un punto del aire de la sala (la cabeza) o varios por orden de preferencia; si el primero
 *  cae dentro de un objeto cerrado (una persona o un altavoz dibujados…), se usa el siguiente. */
export function voxelize(geo: Geometry, dx: number, seed: V3 | V3[]): Grid {
	const seeds = (Array.isArray(seed[0]) ? seed : [seed]) as V3[];
	const T = geo.tris;
	const nT = geo.triMat.length;
	let mn: V3 = [Infinity, Infinity, Infinity];
	let mx: V3 = [-Infinity, -Infinity, -Infinity];
	for (let t = 0; t < nT; t++) {
		if (geo.triMat[t] < 0) continue;
		for (let v = 0; v < 3; v++)
			for (let k = 0; k < 3; k++) {
				const val = T[t * 9 + v * 3 + k];
				if (val < mn[k]) mn[k] = val;
				if (val > mx[k]) mx[k] = val;
			}
	}
	// incluir la semilla y 2 celdas de margen (la primera capa es "exterior" absorbente)
	for (let k = 0; k < 3; k++) {
		mn[k] = Math.min(mn[k], ...seeds.map((s) => s[k])) - 2 * dx;
		mx[k] = Math.max(mx[k], ...seeds.map((s) => s[k])) + 2 * dx;
	}
	const nx = Math.ceil((mx[0] - mn[0]) / dx) + 1;
	const ny = Math.ceil((mx[1] - mn[1]) / dx) + 1;
	const nz = Math.ceil((mx[2] - mn[2]) / dx) + 1;
	const N = nx * ny * nz;
	if (N > 40e6) throw new Error(`Rejilla demasiado grande (${(N / 1e6).toFixed(1)} M celdas). Baja la frecuencia máxima.`);
	const g: Grid = {
		nx, ny, nz, dx, origin: mn, solid: new Uint8Array(N), air: new Uint8Array(N),
		leak: false, leakPoint: null, airCells: 0, airVolume: 0, cellTris: new Map()
	};
	const mark = (p: V3, t: number) => {
		const [x, y, z] = cellOf(g, p);
		if (x < 1 || y < 1 || z < 1 || x >= nx - 1 || y >= ny - 1 || z >= nz - 1) return;
		const i = idx(g, x, y, z);
		g.solid[i] = 1;
		let lst = g.cellTris.get(i);
		if (!lst) g.cellTris.set(i, (lst = []));
		if (lst.length < 8 && lst[lst.length - 1] !== t) lst.push(t);
	};
	const step = dx / 3;
	for (let t = 0; t < nT; t++) {
		if (geo.triMat[t] < 0) continue;
		const o = t * 9;
		const a: V3 = [T[o], T[o + 1], T[o + 2]];
		const b: V3 = [T[o + 3], T[o + 4], T[o + 5]];
		const c: V3 = [T[o + 6], T[o + 7], T[o + 8]];
		const e1: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
		const e2: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
		let n: V3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
		const nl = Math.hypot(n[0], n[1], n[2]);
		if (nl < 1e-12) continue;
		n = [n[0] / nl, n[1] / nl, n[2] / nl];
		const L = Math.max(Math.hypot(...e1), Math.hypot(...e2), Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2]));
		const m = Math.max(1, Math.ceil(L / step));
		const h = 0.45 * dx;
		for (let i = 0; i <= m; i++)
			for (let j = 0; j <= m - i; j++) {
				const u = i / m;
				const v = j / m;
				const p: V3 = [a[0] + u * e1[0] + v * e2[0], a[1] + u * e1[1] + v * e2[1], a[2] + u * e1[2] + v * e2[2]];
				mark(p, t);
				// engrosado a lo largo de la normal: cierra huecos diagonales en superficies inclinadas
				mark([p[0] + h * n[0], p[1] + h * n[1], p[2] + h * n[2]], t);
				mark([p[0] - h * n[0], p[1] - h * n[1], p[2] - h * n[2]], t);
			}
	}
	// capa exterior: sólida (actuará como absorbente si hay fuga)
	for (let z = 0; z < nz; z++)
		for (let y = 0; y < ny; y++)
			for (let x = 0; x < nx; x++)
				if (x === 0 || y === 0 || z === 0 || x === nx - 1 || y === ny - 1 || z === nz - 1) g.solid[idx(g, x, y, z)] = 2;
	// relleno por inundación (6-conexión) desde una semilla; si cae dentro de un sólido, desde la celda
	// libre más cercana. Devuelve las celdas de aire de esa región.
	const sxy = nx * ny;
	const stack = new Int32Array(N);
	const fill = (seedP: V3, air: Uint8Array) => {
		let [sx, sy, sz] = cellOf(g, seedP);
		if (g.solid[idx(g, sx, sy, sz)]) {
			let found = false;
			for (let r = 1; r < 6 && !found; r++)
				for (let dz = -r; dz <= r && !found; dz++)
					for (let dy = -r; dy <= r && !found; dy++)
						for (let ddx = -r; ddx <= r && !found; ddx++) {
							const i = idx(g, sx + ddx, sy + dy, sz + dz);
							if (!g.solid[i]) {
								sx += ddx; sy += dy; sz += dz;
								found = true;
							}
						}
			if (!found) return null;
		}
		let sp = 0, cells = 0;
		let leakPoint: V3 | null = null;
		const s0 = idx(g, sx, sy, sz);
		stack[sp++] = s0;
		air[s0] = 1;
		while (sp > 0) {
			const i = stack[--sp];
			cells++;
			for (const o of [1, -1, nx, -nx, sxy, -sxy]) {
				const j = i + o;
				if (air[j]) continue;
				if (g.solid[j] === 2) {
					if (!leakPoint) {
						const x = i % nx, y = Math.floor(i / nx) % ny, z = Math.floor(i / sxy);
						leakPoint = cellCenter(g, x, y, z);
					}
					continue;
				}
				if (g.solid[j]) continue;
				air[j] = 1;
				stack[sp++] = j;
			}
		}
		return { cells, leakPoint, air };
	};
	// el aire de la sala: el de la primera semilla que no esté encerrada en un objeto (≥ 2 m³); si
	// ninguna lo está, la región más grande
	const MIN_CELLS = 2 / (dx * dx * dx);
	let best: ReturnType<typeof fill> = null;
	for (const s of seeds) {
		const r = fill(s, best ? new Uint8Array(N) : g.air);
		if (r && (!best || r.cells > best.cells)) best = r;
		if (best && best.cells >= MIN_CELLS) break;
	}
	if (!best) throw new Error('La posición de escucha está dentro de un sólido del modelo.');
	if (best.air !== g.air) g.air = best.air;
	g.airCells = best.cells;
	g.leak = !!best.leakPoint;
	g.leakPoint = best.leakPoint;
	refineBoundary(g, geo);
	g.airVolume = g.airCells * dx * dx * dx;
	return g;
}

/**
 * Corrige la posición de las paredes: el engrosado deja el borde del aire hasta ~1 celda dentro de la sala.
 * Una celda sólida pasa a aire si su centro está del lado del aire respecto a TODAS las superficies cercanas
 * y no toca el exterior. Así el borde queda centrado en la superficie real (error medio ≈ 0 en vez de ≈ dx).
 */
function refineBoundary(g: Grid, geo: Geometry) {
	const { nx, ny } = g;
	const sxy = nx * ny;
	const offs = [1, -1, nx, -nx, sxy, -sxy];
	const T = geo.tris;
	const signedDist = (p: V3, t: number) => {
		const o = t * 9;
		const e1: V3 = [T[o + 3] - T[o], T[o + 4] - T[o + 1], T[o + 5] - T[o + 2]];
		const e2: V3 = [T[o + 6] - T[o], T[o + 7] - T[o + 1], T[o + 8] - T[o + 2]];
		const n: V3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
		const l = Math.hypot(n[0], n[1], n[2]) || 1;
		return ((p[0] - T[o]) * n[0] + (p[1] - T[o + 1]) * n[1] + (p[2] - T[o + 2]) * n[2]) / l;
	};
	for (let iter = 0; iter < 3; iter++) {
		const conv: number[] = [];
		for (const [j, cand] of g.cellTris) {
			if (g.solid[j] !== 1) continue;
			let airNb = -1;
			let touchesVoid = false;
			for (const o of offs) {
				const k = j + o;
				if (g.air[k]) airNb = k;
				else if (!g.solid[k]) touchesVoid = true;
			}
			if (airNb < 0 || touchesVoid) continue;
			const pc = cellCenter(g, j % nx, Math.floor(j / nx) % ny, Math.floor(j / sxy));
			const pa = cellCenter(g, airNb % nx, Math.floor(airNb / nx) % ny, Math.floor(airNb / sxy));
			let ok = true;
			let any = false;
			for (const t of cand) {
				if (pointTriDist(pc, T, t) > g.dx) continue;
				any = true;
				const dc = signedDist(pc, t);
				const da = signedDist(pa, t);
				if (dc * da <= 0) { ok = false; break; }
			}
			if (ok && any) conv.push(j);
		}
		if (!conv.length) break;
		for (const j of conv) {
			g.solid[j] = 0;
			g.air[j] = 1;
			g.airCells++;
		}
	}
}

/** Distancia punto-triángulo (Ericson, Real-Time Collision Detection). */
export function pointTriDist(p: V3, T: Float32Array, t: number): number {
	const o = t * 9;
	const a: V3 = [T[o], T[o + 1], T[o + 2]];
	const b: V3 = [T[o + 3], T[o + 4], T[o + 5]];
	const c: V3 = [T[o + 6], T[o + 7], T[o + 8]];
	const sub = (u: V3, v: V3): V3 => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
	const dot = (u: V3, v: V3) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
	const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
	const d1 = dot(ab, ap), d2 = dot(ac, ap);
	let q: V3;
	if (d1 <= 0 && d2 <= 0) q = a;
	else {
		const bp = sub(p, b);
		const d3 = dot(ab, bp), d4 = dot(ac, bp);
		if (d3 >= 0 && d4 <= d3) q = b;
		else {
			const vc = d1 * d4 - d3 * d2;
			if (vc <= 0 && d1 >= 0 && d3 <= 0) {
				const v = d1 / (d1 - d3);
				q = [a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]];
			} else {
				const cp = sub(p, c);
				const d5 = dot(ab, cp), d6 = dot(ac, cp);
				if (d6 >= 0 && d5 <= d6) q = c;
				else {
					const vb = d5 * d2 - d1 * d6;
					if (vb <= 0 && d2 >= 0 && d6 <= 0) {
						const w = d2 / (d2 - d6);
						q = [a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]];
					} else {
						const va = d3 * d6 - d5 * d4;
						if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
							const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
							q = [b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])];
						} else {
							const den = 1 / (va + vb + vc);
							const v = vb * den, w = vc * den;
							q = [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
						}
					}
				}
			}
		}
	}
	return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}
