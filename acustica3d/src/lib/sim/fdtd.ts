// Simulación de ondas 3D por diferencias finitas (FDTD, esquema rectilíneo estándar, λ = 1/√3)
// con contornos de reacción local y admitancia real por material (formulación de volúmenes finitos:
// Kowalczyk & van Walstijn 2011). Fuente puntual "blanda" de banda limitada.
//
// Normalización: H(f) = P(f) / (S(f)·K) con K = Δx/(4π λ²) → 0 dB = campo libre a 1 m de la fuente.

import { type Grid, type V3, type Geometry, idx, cellOf, cellCenter, pointTriDist } from './voxel';

export const C = 343;
export const LAMBDA = 1 / Math.sqrt(3);

export interface Prepared {
	grid: Grid;
	dt: number;
	fs: number;
	interior: Int32Array;
	bnd: Int32Array;
	bA: Float32Array; // 1/(1+λB/2)
	bB: Float32Array; // 2 − Kλ²
	bC: Float32Array; // 1 − λB/2
	/** superficie de contorno por material (m²) */
	areaByMat: Map<number, number>;
}

/** Prepara los coeficientes de contorno. betaByMat: admitancia normalizada por material; leakBeta para el exterior. */
export function prepare(grid: Grid, geo: Geometry, betaByMat: number[], leakBeta = 1): Prepared {
	const { nx, ny, nz } = grid;
	const sxy = nx * ny;
	const offs = [1, -1, nx, -nx, sxy, -sxy];
	const interior: number[] = [];
	const bnd: number[] = [];
	const bA: number[] = [];
	const bB: number[] = [];
	const bC: number[] = [];
	const areaByMat = new Map<number, number>();
	const face = grid.dx * grid.dx;
	const L2 = LAMBDA * LAMBDA;
	for (let i = 0; i < grid.air.length; i++) {
		if (!grid.air[i]) continue;
		let K = 0;
		let B = 0;
		for (const o of offs) {
			const j = i + o;
			if (grid.air[j]) {
				K++;
				continue;
			}
			// cara de contorno: material del triángulo candidato más cercano a la celda de aire
			if (grid.solid[j] === 2) {
				B += leakBeta;
				continue;
			}
			const cand = grid.cellTris.get(j);
			let mat = -1;
			if (cand && cand.length) {
				const x = i % nx, y = Math.floor(i / nx) % ny, z = Math.floor(i / sxy);
				const p = cellCenter(grid, x, y, z);
				let best = Infinity;
				for (const t of cand) {
					const d = pointTriDist(p, geo.tris, t);
					if (d < best) {
						best = d;
						mat = geo.triMat[t];
					}
				}
			}
			const beta = mat >= 0 ? betaByMat[mat] ?? 0 : 0;
			B += beta;
			areaByMat.set(mat, (areaByMat.get(mat) ?? 0) + face);
		}
		if (K === 6) interior.push(i);
		else {
			bnd.push(i);
			bA.push(1 / (1 + (LAMBDA * B) / 2));
			bB.push(2 - K * L2);
			bC.push(1 - (LAMBDA * B) / 2);
		}
	}
	const dt = (LAMBDA * grid.dx) / C;
	return {
		grid, dt, fs: 1 / dt,
		interior: Int32Array.from(interior), bnd: Int32Array.from(bnd),
		bA: Float32Array.from(bA), bB: Float32Array.from(bB), bC: Float32Array.from(bC), areaByMat
	};
}

/** Pulso de banda limitada sin continua: sinc paso bajo (corte fc) con ventana Blackman, derivado. */
export function sourcePulse(fs: number, fc: number): Float32Array {
	const half = Math.ceil((3 * fs) / fc);
	const n = 2 * half + 1;
	const g = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		const t = i - half;
		const x = (2 * fc) / fs;
		const sinc = t === 0 ? x : Math.sin(Math.PI * x * t) / (Math.PI * t);
		const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (n - 1));
		g[i] = sinc * w;
	}
	const s = new Float32Array(n + 1);
	for (let i = 0; i <= n; i++) s[i] = (i < n ? g[i] : 0) - (i > 0 ? g[i - 1] : 0);
	return s;
}

export interface RunInput {
	prep: Prepared;
	source: V3;
	receivers: V3[];
	durationS: number;
	fmax: number;
	/** altura (Y) del plano de mapas; null = sin mapa */
	planeY: number | null;
	onProgress?: (frac: number) => void;
}

export interface RunOutput {
	fs: number;
	pulse: Float32Array;
	K: number; // normalización a campo libre a 1 m
	irs: Float32Array[];
	receiverCells: V3[];
	plane: null | {
		decim: number;
		fsPlane: number;
		nSamples: number;
		ix: Int32Array; // coordenada x de la celda
		iz: Int32Array; // coordenada z de la celda
		data: Float32Array; // cells × nSamples
		nx: number;
		nz: number;
		y: number;
	};
	sourceCell: V3;
}

function nearestAir(grid: Grid, p: V3): number {
	const [x0, y0, z0] = cellOf(grid, p);
	for (let r = 0; r < 8; r++)
		for (let dz = -r; dz <= r; dz++)
			for (let dy = -r; dy <= r; dy++)
				for (let dx = -r; dx <= r; dx++) {
					if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
					const x = x0 + dx, y = y0 + dy, z = z0 + dz;
					if (x < 0 || y < 0 || z < 0 || x >= grid.nx || y >= grid.ny || z >= grid.nz) continue;
					const i = idx(grid, x, y, z);
					if (grid.air[i]) return i;
				}
	throw new Error('Un punto (altavoz u oyente) queda fuera del aire de la sala.');
}

export function run(inp: RunInput): RunOutput {
	const { prep } = inp;
	const g = prep.grid;
	const N = g.air.length;
	const nx = g.nx, ny = g.ny;
	const sxy = nx * ny;
	let p0 = new Float32Array(N);
	let p1 = new Float32Array(N);
	let p2 = new Float32Array(N);
	const pulse = sourcePulse(prep.fs, inp.fmax);
	const steps = Math.ceil(inp.durationS * prep.fs) + pulse.length;
	const src = nearestAir(g, inp.source);
	const rcv = inp.receivers.map((r) => nearestAir(g, r));
	const irs = rcv.map(() => new Float32Array(steps));
	const toXYZ = (i: number): V3 => [i % nx, Math.floor(i / nx) % ny, Math.floor(i / sxy)];

	// plano de mapas
	let plane: RunOutput['plane'] = null;
	let planeIdx: Int32Array | null = null;
	let decim = 1;
	if (inp.planeY !== null) {
		const yc = Math.min(g.ny - 2, Math.max(1, Math.floor((inp.planeY - g.origin[1]) / g.dx)));
		const cells: number[] = [];
		const ixs: number[] = [];
		const izs: number[] = [];
		for (let z = 0; z < g.nz; z++)
			for (let x = 0; x < g.nx; x++) {
				const i = idx(g, x, yc, z);
				if (g.air[i]) {
					cells.push(i);
					ixs.push(x);
					izs.push(z);
				}
			}
		decim = Math.max(1, Math.floor(prep.fs / (2.6 * inp.fmax)));
		const nS = Math.floor(steps / decim);
		planeIdx = Int32Array.from(cells);
		plane = {
			decim, fsPlane: prep.fs / decim, nSamples: nS, ix: Int32Array.from(ixs), iz: Int32Array.from(izs),
			data: new Float32Array(cells.length * nS), nx: g.nx, nz: g.nz, y: yc
		};
	}

	const I = prep.interior;
	const Bi = prep.bnd;
	const bA = prep.bA, bB = prep.bB, bC = prep.bC;
	const L2 = LAMBDA * LAMBDA;
	const progEvery = Math.max(1, Math.floor(steps / 100));
	for (let n = 0; n < steps; n++) {
		// interior (K = 6, λ² = 1/3): p2 = Σ/3 − p0
		for (let k = 0; k < I.length; k++) {
			const i = I[k];
			p2[i] = (p1[i + 1] + p1[i - 1] + p1[i + nx] + p1[i - nx] + p1[i + sxy] + p1[i - sxy]) * L2 - p0[i];
		}
		// contorno (las celdas sólidas valen siempre 0)
		for (let k = 0; k < Bi.length; k++) {
			const i = Bi[k];
			const s = p1[i + 1] + p1[i - 1] + p1[i + nx] + p1[i - nx] + p1[i + sxy] + p1[i - sxy];
			p2[i] = (bB[k] * p1[i] + L2 * s - bC[k] * p0[i]) * bA[k];
		}
		if (n < pulse.length) p2[src] += pulse[n];
		for (let r = 0; r < rcv.length; r++) irs[r][n] = p2[rcv[r]];
		if (plane && planeIdx && n % decim === 0) {
			const m = n / decim;
			if (m < plane.nSamples) {
				const ns = plane.nSamples;
				for (let c = 0; c < planeIdx.length; c++) plane.data[c * ns + m] = p2[planeIdx[c]];
			}
		}
		const t = p0;
		p0 = p1;
		p1 = p2;
		p2 = t;
		if (inp.onProgress && n % progEvery === 0) inp.onProgress(n / steps);
	}
	return {
		fs: prep.fs, pulse, K: g.dx / (4 * Math.PI * L2), irs,
		receiverCells: rcv.map(toXYZ), plane, sourceCell: toXYZ(src)
	};
}
