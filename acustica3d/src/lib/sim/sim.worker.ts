/// <reference lib="webworker" />
// Worker de simulación con refinado progresivo: varias pasadas de rejilla cada vez más fina
// (más frecuencia y más puntos), cada una sustituye a la anterior. Usa la GPU (WebGPU) si hay,
// y si no el procesador. Para cancelar, el hilo principal termina el worker.
import { voxelize, type V3, type Grid } from './voxel';
import { prepare, run, sourcePulse, type RunOutput } from './fdtd';
import { getDevice, uploadGrid, runGpu, destroyGrid, gpuInfo, isSoftwareGpu } from './gpu';
import { goertzel } from '../dsp/analysis';
import type { Cx } from '../acoustics/speakers';
import { wallCriteria, type PlaneSpectra, type Criterion } from '../analysis/score';
import { khPair, acousticParts, totalScore, GainCache, tuneSettings, type PointTF, type OptConfig, type Settings } from './optimize';
import { bayesSearch, type P2 } from './bayes';
import { objectTris, type RoomObject } from '../geometry/objects';
import { roomBounds, placePanels, trapSlots, atSlot, collides, isCornerTrap, type Bounds, type Slot } from './treatment';

export interface LevelSpec {
	fmax: number;
	durationS: number;
}

export interface RunRequest {
	type: 'run';
	tris: Float32Array;
	triMat: Int32Array;
	betaByMat: number[];
	levels: LevelSpec[];
	ppw: number;
	/** un punto del aire de la sala, o varios por preferencia (ver voxelize) */
	seed: V3 | V3[];
	sources: { id: string; pos: V3 }[];
	receivers: V3[];
	planeY: number;
	/** auto: GPU solo si es real y la rejilla es grande; gpu: siempre que haya; cpu: nunca */
	engine: 'auto' | 'gpu' | 'cpu';
	tLate: number;
}

export interface MapRequest {
	type: 'map';
	reqId: number;
	freqs: number[];
	gains: Record<string, Cx[]>;
}

/** Fotogramas de la animación del mapa: respuesta compleja de cada fuente en cada celda, barrido logarítmico. */
export interface FramesRequest {
	type: 'frames';
	reqId: number;
	fLo: number;
	fHi: number;
	perOctave: number;
}

export interface FramesChunk {
	type: 'frames';
	reqId: number;
	start: number;
	total: number;
	freqs: number[]; // todas las frecuencias del barrido
	ids: string[];
	nCells: number;
	ix: Int32Array;
	iz: Int32Array;
	nx: number;
	nz: number;
	/** por fuente: (fotogramas del bloque × celdas), normalizado como el resto (0 dB = campo libre a 1 m) */
	re: Float32Array[];
	im: Float32Array[];
}

/** Búsqueda de la mejor colocación (ver optimize.ts). */
export interface OptRequest {
	type: 'optimize';
	tris: Float32Array;
	triMat: Int32Array;
	betaByMat: number[];
	/** un punto del aire de la sala, o varios por preferencia (ver voxelize) */
	seed: V3 | V3[];
	fmax: number;
	ppw: number;
	durationS: number;
	engine: 'auto' | 'gpu' | 'cpu';
	tLate: number;
	listenerY: number;
	khY: number;
	subY: number;
	subEnabled: boolean;
	freqs: number[];
	/** ajustes actuales (punto de partida) y cuáles se pueden cambiar */
	start: Settings;
	tune: (keyof Settings)[];
	subDelayMs: number;
	weights: Record<Criterion, number>;
	distances: number[];
	apertures: number[];
	facings: number[];
	/** distancia máxima (m) del sub al punto medio de los KH; null = cualquier sitio */
	subMaxDist: number | null;
	/** separación de la rejilla gruesa de posiciones del oyente (m) */
	step: number;
	/** rejilla: recorre la sala y afina alrededor de los mejores; bayes: elige cada posición que simular
	 *  según lo aprendido de las anteriores (bayes.ts), con `base + perM2 · m² de zona válida` simulaciones */
	method: 'rejilla' | 'bayes';
	bayes: { base: number; perM2: number; max: number };
	/** mover también trampas y paneles: los primeros `nStatic` triángulos de `tris` son la sala fija; los
	 *  objetos van detrás (uno por objeto, con su material `objMat`) */
	treatment: { nStatic: number; objects: RoomObject[]; objMat: number[] } | null;
	current: { listener: V3; khL: V3; khR: V3; sub: V3 | null };
}

export type OptMsg =
	| { type: 'opt-start'; mask: Uint8Array; nx: number; nz: number; dx: number; origin: V3; total: number; engine: string; nSub: number }
	| { type: 'opt-step'; done: number; total: number; phase: string; frac: number; testing: V3 | null; tested: { pos: V3; score: number }[]; top: OptConfig[]; current: OptConfig | null }
	| {
			type: 'opt-done'; elapsedS: number; top: OptConfig[]; current: OptConfig | null; currentTuned: OptConfig | null; tested: { pos: V3; score: number }[];
			/** con tratamiento: dónde quedan trampas y paneles, la caja de la sala (para recolocar los paneles
			 *  al aplicar otra fila) y qué se ha cambiado */
			layout: RoomObject[] | null; bounds: Bounds | null; log: string[];
	  }

/** Candidato interno: además de la combinación, sus respuestas (para afinar los ajustes sin simular). */
type Cand = OptConfig & { tf: { L: PointTF; R: PointTF; S: PointTF | null }; wall: { sideAsym: number; near: number } };
const strip = (c: Cand | null): OptConfig | null => {
	if (!c) return null;
	const { tf: _tf, wall: _w, ...rest } = c;
	return rest;
};

export interface LevelResult {
	type: 'level';
	level: number;
	nLevels: number;
	fmax: number;
	engine: string;
	grid: { nx: number; ny: number; nz: number; dx: number; origin: V3; airCells: number; airVolume: number; leak: boolean; leakPoint: V3 | null };
	fs: number;
	K: number;
	pulse: Float32Array;
	areaByMat: [number, number][];
	results: { id: string; irs: Float32Array[]; sourceCell: V3; receiverCells: V3[] }[];
	plane: { nx: number; nz: number; ix: Int32Array; iz: Int32Array; y: number } | null;
	spectra: PlaneSpectra | null;
	elapsedS: number;
}

export type WorkerMsg =
	| { type: 'progress'; stage: string; frac: number; level: number; nLevels: number }
	| { type: 'error'; message: string }
	| { type: 'ready' }
	| LevelResult
	| { type: 'map'; reqId: number; values: Float32Array; ix: Int32Array; iz: Int32Array; nx: number; nz: number }
	| FramesChunk
	| OptMsg;

let planes: Record<string, NonNullable<RunOutput['plane']>> = {};
let pulseInfo: { pulse: Float32Array; fs: number; K: number } | null = null;

const post = (m: WorkerMsg, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

// primer mensaje: el programa de cálculo se ha cargado (para distinguirlo de un fallo al arrancar)
post({ type: 'ready' });

// lo que se escape (también promesas sin capturar) llega al hilo principal con su mensaje
self.addEventListener('unhandledrejection', (ev) => {
	const e = (ev as PromiseRejectionEvent).reason;
	post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
});

self.onmessage = (ev: MessageEvent<RunRequest | MapRequest | FramesRequest | OptRequest>) => {
	const msg = ev.data;
	const fail = (e: unknown) => post({ type: 'error', message: e instanceof Error ? `${e.message}${e.stack ? `\n${e.stack}` : ''}` : String(e) });
	try {
		if (msg.type === 'run') runLevels(msg).catch(fail);
		else if (msg.type === 'map') doMap(msg);
		else if (msg.type === 'frames') doFrames(msg).catch(fail);
		else if (msg.type === 'optimize') doOptimize(msg).catch(fail);
	} catch (e) {
		fail(e);
	}
};

/** Distancia (m) de cada celda del plano al obstáculo más cercano en ese mismo plano (BFS 8-vecinos). */
function planeWallDist(grid: Grid, ix: Int32Array, iz: Int32Array, y: number): Float32Array {
	const { nx, nz } = grid;
	const dist = new Float32Array(nx * nz).fill(Infinity);
	const q: number[] = [];
	for (let z = 0; z < nz; z++)
		for (let x = 0; x < nx; x++) {
			const i = x + nx * (y + grid.ny * z);
			if (!grid.air[i]) {
				dist[z * nx + x] = 0;
				q.push(z * nx + x);
			}
		}
	for (let h = 0; h < q.length; h++) {
		const k = q[h];
		const x = k % nx, z = Math.floor(k / nx);
		for (let dz = -1; dz <= 1; dz++)
			for (let dx = -1; dx <= 1; dx++) {
				if (!dx && !dz) continue;
				const X = x + dx, Z = z + dz;
				if (X < 0 || Z < 0 || X >= nx || Z >= nz) continue;
				const nd = dist[k] + (dx && dz ? Math.SQRT2 : 1);
				if (nd < dist[Z * nx + X]) {
					dist[Z * nx + X] = nd;
					q.push(Z * nx + X);
				}
			}
	}
	const out = new Float32Array(ix.length);
	for (let c = 0; c < ix.length; c++) out[c] = dist[iz[c] * nx + ix[c]] * grid.dx;
	return out;
}

/** Aire (1) u obstáculo (0) en la capa y de la rejilla, como imagen nx × nz. */
function planeMask(grid: Grid, y: number): Uint8Array {
	const m = new Uint8Array(grid.nx * grid.nz);
	for (let z = 0; z < grid.nz; z++) for (let x = 0; x < grid.nx; x++) m[z * grid.nx + x] = grid.air[x + grid.nx * (y + grid.ny * z)] ? 1 : 0;
	return m;
}

/** Espectros de cada celda del plano a frecuencias logarítmicas (completo y tardío). */
function planeSpectra(
	ids: string[], pl: Record<string, NonNullable<RunOutput['plane']>>, pulse: Float32Array, fs: number, K: number,
	fmax: number, tLate: number, grid: Grid
): PlaneSpectra | null {
	const p0 = pl[ids[0]];
	if (!p0) return null;
	const fHi = 0.8 * fmax; // hasta donde la simulación es válida
	const freqs: number[] = [];
	for (let f = 20; f <= fHi; f *= Math.pow(2, 1 / 12)) freqs.push(f);
	const nC = p0.ix.length, nF = freqs.length;
	const S = freqs.map((f) => goertzel(pulse, 0, pulse.length, f, fs));
	const out: PlaneSpectra = {
		freqs, ids, re: [], im: [], lateRe: [], lateIm: [], ix: p0.ix, iz: p0.iz,
		wallDist: planeWallDist(grid, p0.ix, p0.iz, p0.y), nx: p0.nx, nz: p0.nz, dx: grid.dx, origin: grid.origin, y: p0.y,
		mask: planeMask(grid, p0.y)
	};
	for (const id of ids) {
		const p = pl[id];
		const re = new Float32Array(nC * nF), im = new Float32Array(nC * nF);
		const lre = new Float32Array(nC * nF), lim = new Float32Array(nC * nF);
		const m0 = Math.min(p.nSamples - 1, Math.ceil(tLate * p.fsPlane));
		for (let k = 0; k < nF; k++) {
			const sr = S[k][0] * K, si = S[k][1] * K;
			const d = sr * sr + si * si;
			for (let c = 0; c < nC; c++) {
				const off = c * p.nSamples;
				const X = goertzel(p.data, off, p.nSamples, freqs[k], p.fsPlane);
				const L = goertzel(p.data, off + m0, p.nSamples - m0, freqs[k], p.fsPlane);
				const xr = X[0] * p.decim, xi = X[1] * p.decim;
				const lr = L[0] * p.decim, li = L[1] * p.decim;
				const o = c * nF + k;
				re[o] = (xr * sr + xi * si) / d;
				im[o] = (xi * sr - xr * si) / d;
				lre[o] = (lr * sr + li * si) / d;
				lim[o] = (li * sr - lr * si) / d;
			}
		}
		out.re.push(re);
		out.im.push(im);
		out.lateRe.push(lre);
		out.lateIm.push(lim);
	}
	return out;
}

/** Por debajo de este número de celdas cada paso es tan corto que la GPU pierde por la sobrecarga
 *  de lanzar cada paso; el procesador termina antes. */
const GPU_MIN_CELLS = 120_000;

async function runLevels(r: RunRequest) {
	const geo = { tris: r.tris, triMat: r.triMat };
	let device = r.engine !== 'cpu' ? await getDevice() : null;
	const soft = device ? isSoftwareGpu() : false;
	const gpuName = device ? ((await gpuInfo()) ?? 'WebGPU') : '';
	let gpuError = '';
	const nL = r.levels.length;
	for (let li = 0; li < nL; li++) {
		const t0 = performance.now();
		const { fmax, durationS } = r.levels[li];
		const dx = 343 / (fmax * r.ppw);
		const prog = (stage: string, frac: number) => post({ type: 'progress', stage, frac, level: li, nLevels: nL });
		prog(`Nivel ${li + 1}/${nL} (hasta ${fmax} Hz): discretizando`, 0);
		const grid = voxelize(geo, dx, r.seed);
		const prep = prepare(grid, geo, r.betaByMat);
		planes = {};
		const results: LevelResult['results'] = [];
		let K = 0;
		let pulse = sourcePulse(prep.fs, fmax);
		let ctx = null;
		const cells = grid.nx * grid.ny * grid.nz;
		const useGpu = !!device && (r.engine === 'gpu' || (!soft && cells >= GPU_MIN_CELLS));
		let engine = useGpu
			? `GPU (${gpuName})`
			: gpuError
				? `Procesador (${gpuError})`
				: device
					? `Procesador (${soft ? 'la GPU disponible es emulada por software' : 'rejilla pequeña: así es más rápido'})`
					: r.engine === 'cpu' ? 'Procesador' : 'Procesador (sin WebGPU en este navegador)';
		if (useGpu && device) {
			try {
				ctx = uploadGrid(device, prep);
			} catch {
				device = null;
				gpuError = 'la GPU no tenía memoria suficiente';
				engine = `Procesador (${gpuError})`;
			}
		}
		for (let si = 0; si < r.sources.length; si++) {
			const s = r.sources[si];
			const tag = ctx ? ' (GPU)' : '';
			const onProgress = (f: number) => prog(`Nivel ${li + 1}/${nL} (hasta ${fmax} Hz): ${s.id}${tag}`, (si + f) / r.sources.length);
			const args = { source: s.pos, receivers: r.receivers, durationS, fmax, planeY: r.planeY, onProgress };
			let out: RunOutput;
			if (ctx) {
				try {
					out = await runGpu(ctx, args);
				} catch (e) {
					destroyGrid(ctx);
					ctx = null;
					device = null;
					gpuError = `fallo de la GPU: ${e instanceof Error ? e.message : e}`;
					engine = `Procesador (${gpuError})`;
					out = run({ prep, ...args });
				}
			} else out = run({ prep, ...args });
			K = out.K;
			pulse = out.pulse;
			if (out.plane) planes[s.id] = out.plane;
			results.push({ id: s.id, irs: out.irs, sourceCell: out.sourceCell, receiverCells: out.receiverCells });
		}
		if (ctx) destroyGrid(ctx);
		pulseInfo = { pulse, fs: prep.fs, K };
		prog(`Nivel ${li + 1}/${nL}: calculando el mapa de posiciones`, 1);
		const ids = r.sources.map((s) => s.id);
		const spectra = planeSpectra(ids, planes, pulse, prep.fs, K, fmax, r.tLate, grid);
		const any = Object.values(planes)[0];
		const msg: LevelResult = {
			type: 'level', level: li, nLevels: nL, fmax, engine,
			grid: { nx: grid.nx, ny: grid.ny, nz: grid.nz, dx: grid.dx, origin: grid.origin, airCells: grid.airCells, airVolume: grid.airVolume, leak: grid.leak, leakPoint: grid.leakPoint },
			fs: prep.fs, K, pulse,
			areaByMat: [...prep.areaByMat.entries()],
			results,
			plane: any ? { nx: any.nx, nz: any.nz, ix: any.ix, iz: any.iz, y: any.y } : null,
			spectra,
			elapsedS: (performance.now() - t0) / 1000
		};
		post(msg);
	}
}

function doMap(m: MapRequest) {
	const ids = Object.keys(planes);
	if (!ids.length || !pulseInfo) throw new Error('No hay simulación con mapa.');
	const p0 = planes[ids[0]];
	const nCells = p0.ix.length;
	const acc = new Float64Array(nCells);
	const { pulse, fs, K } = pulseInfo;
	m.freqs.forEach((f, fi) => {
		const S = goertzel(pulse, 0, pulse.length, f, fs);
		const re = new Float64Array(nCells);
		const im = new Float64Array(nCells);
		for (const id of ids) {
			const g = m.gains[id]?.[fi];
			if (!g) continue;
			const pl = planes[id];
			const sr = S[0] * K, si = S[1] * K;
			const d = sr * sr + si * si;
			for (let c = 0; c < nCells; c++) {
				const X = goertzel(pl.data, c * pl.nSamples, pl.nSamples, f, pl.fsPlane);
				const xr = X[0] * pl.decim, xi = X[1] * pl.decim;
				const hr = (xr * sr + xi * si) / d;
				const hi = (xi * sr - xr * si) / d;
				re[c] += hr * g[0] - hi * g[1];
				im[c] += hr * g[1] + hi * g[0];
			}
		}
		for (let c = 0; c < nCells; c++) acc[c] += re[c] * re[c] + im[c] * im[c];
	});
	const values = new Float32Array(nCells);
	for (let c = 0; c < nCells; c++) values[c] = 10 * Math.log10(Math.max(acc[c] / m.freqs.length, 1e-20));
	post({ type: 'map', reqId: m.reqId, values, ix: p0.ix, iz: p0.iz, nx: p0.nx, nz: p0.nz });
}

let framesReq = 0;

/** Precalcula el barrido de frecuencias del mapa por bloques (cede el turno entre bloques: así
 *  se atienden otras peticiones y una petición nueva cancela la anterior). */
async function doFrames(m: FramesRequest) {
	framesReq = m.reqId;
	const ids = Object.keys(planes);
	if (!ids.length || !pulseInfo) throw new Error('No hay simulación con mapa.');
	const p0 = planes[ids[0]];
	const nC = p0.ix.length;
	const freqs: number[] = [];
	const n = Math.round(Math.log2(m.fHi / m.fLo) * m.perOctave);
	for (let i = 0; i <= n; i++) freqs.push(m.fLo * Math.pow(m.fHi / m.fLo, i / n));
	const { pulse, fs, K } = pulseInfo;
	const CH = 6;
	for (let start = 0; start < freqs.length; start += CH) {
		if (framesReq !== m.reqId) return;
		const len = Math.min(CH, freqs.length - start);
		const re: Float32Array[] = [], im: Float32Array[] = [];
		for (const id of ids) {
			const pl = planes[id];
			const r = new Float32Array(len * nC), q = new Float32Array(len * nC);
			for (let j = 0; j < len; j++) {
				const f = freqs[start + j];
				const S = goertzel(pulse, 0, pulse.length, f, fs);
				const sr = S[0] * K, si = S[1] * K;
				const d = sr * sr + si * si;
				for (let c = 0; c < nC; c++) {
					const X = goertzel(pl.data, c * pl.nSamples, pl.nSamples, f, pl.fsPlane);
					const xr = X[0] * pl.decim, xi = X[1] * pl.decim;
					r[j * nC + c] = (xr * sr + xi * si) / d;
					q[j * nC + c] = (xi * sr - xr * si) / d;
				}
			}
			re.push(r);
			im.push(q);
		}
		const msg: FramesChunk = { type: 'frames', reqId: m.reqId, start, total: freqs.length, freqs, ids, nCells: nC, ix: p0.ix, iz: p0.iz, nx: p0.nx, nz: p0.nz, re, im };
		post(msg, [...re.map((a) => a.buffer), ...im.map((a) => a.buffer)]);
		await new Promise((res) => setTimeout(res, 0));
	}
}

/** Respuesta en un punto a partir de su respuesta al impulso (deconvolución del pulso). */
function pointTF(ir: Float32Array, pulse: Float32Array, fs: number, K: number, freqs: number[], tLate: number): PointTF {
	const n = freqs.length;
	const out: PointTF = { re: new Float32Array(n), im: new Float32Array(n), lateRe: new Float32Array(n), lateIm: new Float32Array(n) };
	const m0 = Math.min(ir.length - 1, Math.ceil(tLate * fs));
	for (let k = 0; k < n; k++) {
		const S = goertzel(pulse, 0, pulse.length, freqs[k], fs);
		const sr = S[0] * K, si = S[1] * K, d = sr * sr + si * si;
		const X = goertzel(ir, 0, ir.length, freqs[k], fs);
		const Lt = goertzel(ir, m0, ir.length - m0, freqs[k], fs);
		out.re[k] = (X[0] * sr + X[1] * si) / d;
		out.im[k] = (X[1] * sr - X[0] * si) / d;
		out.lateRe[k] = (Lt[0] * sr + Lt[1] * si) / d;
		out.lateIm[k] = (Lt[1] * sr - Lt[0] * si) / d;
	}
	return out;
}

async function doOptimize(r: OptRequest) {
	const t0 = performance.now();
	const geo = { tris: r.tris, triMat: r.triMat };
	const dx = 343 / (r.fmax * r.ppw);
	const T = r.treatment;
	let grid = voxelize(geo, dx, r.seed);
	let prep = prepare(grid, geo, r.betaByMat);
	const cellAt = (p: V3) => [0, 1, 2].map((k) => Math.floor((p[k] - grid.origin[k]) / dx)) as V3;
	const airAt = (p: V3) => {
		const [x, y, z] = cellAt(p);
		if (x < 1 || y < 1 || z < 1 || x >= grid.nx - 1 || y >= grid.ny - 1 || z >= grid.nz - 1) return false;
		return grid.air[x + grid.nx * (y + grid.ny * z)] === 1;
	};
	/** el punto y un círculo de radio `rad` a su alrededor están en el aire */
	const clear = (p: V3, rad: number) => {
		if (!airAt(p)) return false;
		for (let a = 0; a < 8; a++) {
			const t = (a * Math.PI) / 4;
			if (!airAt([p[0] + rad * Math.cos(t), p[1], p[2] + rad * Math.sin(t)])) return false;
		}
		return true;
	};
	const yL = Math.min(grid.ny - 2, Math.max(1, Math.floor((r.listenerY - grid.origin[1]) / dx)));
	const mask = planeMask(grid, yL);
	const plane = { mask, nx: grid.nx, nz: grid.nz, dx, origin: grid.origin };

	// candidatos del sub (en el suelo, rejilla de 25 cm, también en rincones)
	const subCands: V3[] = [];
	if (r.subEnabled) {
		for (let x = grid.origin[0]; x < grid.origin[0] + grid.nx * dx; x += 0.25)
			for (let z = grid.origin[2]; z < grid.origin[2] + grid.nz * dx; z += 0.25) {
				const p: V3 = [x, r.subY, z];
				if (clear(p, 0.2)) subCands.push(p);
			}
		if (r.current.sub && airAt(r.current.sub)) subCands.push(r.current.sub);
	}
	// posiciones del oyente (cabeza a ≥ 0,5 m de cualquier pared): rejilla gruesa o, para la búsqueda
	// bayesiana, todos los sitios posibles cada 10 cm
	const listenerGrid = (h: number, off: number) => {
		const out: V3[] = [];
		for (let x = grid.origin[0] + off; x < grid.origin[0] + grid.nx * dx; x += h)
			for (let z = grid.origin[2] + off; z < grid.origin[2] + grid.nz * dx; z += h) {
				const p: V3 = [x, r.listenerY, z];
				if (clear(p, 0.5)) out.push(p);
			}
		return out;
	};
	const BAYES_H = 0.1;
	const grid1 = r.method === 'rejilla' ? listenerGrid(r.step, r.step / 2) : [];
	const bayesCands: P2[] = r.method === 'bayes' ? listenerGrid(BAYES_H, BAYES_H / 2).map((p) => [p[0], p[2]]) : [];
	const budget = Math.min(bayesCands.length, r.bayes.max, Math.round(r.bayes.base + r.bayes.perM2 * bayesCands.length * BAYES_H * BAYES_H));
	const refineN = 3 * 8 + 8;
	let total = 1 + (r.method === 'bayes' ? budget : grid1.length + refineN) + (r.tune.length ? 1 : 0);
	const gc = new GainCache(r.freqs, r.subDelayMs);

	// motor
	let device = r.engine !== 'cpu' ? await getDevice() : null;
	const cells = grid.nx * grid.ny * grid.nz;
	const useGpu = !!device && (r.engine === 'gpu' || (!isSoftwareGpu() && cells >= GPU_MIN_CELLS));
	let ctx = useGpu && device ? (() => { try { return uploadGrid(device!, prep); } catch { return null; } })() : null;
	const engine = ctx ? `GPU (${(await gpuInfo()) ?? 'WebGPU'})` : 'Procesador';
	post({ type: 'opt-start', mask, nx: grid.nx, nz: grid.nz, dx, origin: grid.origin, total, engine, nSub: subCands.length });

	const tested: { pos: V3; score: number }[] = [];
	const configs: Cand[] = []; // los mejores de cada posición de escucha
	let current: Cand | null = null;
	let currentTuned: Cand | null = null;
	const testedKeys = new Set<string>();
	const key = (p: V3) => `${Math.round(p[0] * 100)}|${Math.round(p[2] * 100)}`;
	let done = 0;
	let phase = 'Probando tu colocación actual';

	const topCands = (n: number) => {
		const out: Cand[] = [];
		for (const c of [...configs].sort((a, b) => b.score - a.score)) {
			if (out.some((o) => Math.hypot(o.listener[0] - c.listener[0], o.listener[2] - c.listener[2]) < 0.15 && o.facing === c.facing)) continue;
			out.push(c);
			if (out.length >= n) break;
		}
		return out;
	};
	const top = () => topCands(5).map((c) => strip(c)!);
	const step = (testing: V3 | null, frac: number) =>
		post({ type: 'opt-step', done, total, phase, frac, testing, tested: tested.slice(), top: top(), current: strip(current) });
	// puntuación de una combinación ya simulada con unos ajustes
	const scoreWith = (tf: Cand['tf'], wall: Cand['wall'], st: Settings) => {
		const ac = acousticParts(tf.L, tf.R, tf.S, gc.gK(st), gc.gS(st), st.invert ? -1 : 1);
		const parts = { ...ac, simetria: 0.65 * wall.sideAsym + 0.35 * ac.simetria, paredes: wall.near };
		return { score: totalScore(parts, r.weights), parts };
	};
	const canInvert = r.tune.includes('invert');

	/** Simula con la fuente en la cabeza y puntúa todas las combinaciones de KH y sub. */
	async function evaluate(P: V3, extra?: OptRequest['current']): Promise<Cand[]> {
		const pairs: { facing: number; dist: number; aperture: number; khL: V3; khR: V3 }[] = [];
		for (const facing of r.facings)
			for (const aperture of r.apertures)
				for (const dist of r.distances) {
					const { khL, khR } = khPair(P, facing, dist, r.khY, aperture);
					if (clear(khL, 0.15) && clear(khR, 0.15)) pairs.push({ facing, dist, aperture, khL, khR });
				}
		const receivers: V3[] = [];
		for (const p of pairs) receivers.push(p.khL, p.khR);
		// con el sub limitado a cerca de los KH, solo hacen falta los sitios a su alcance desde aquí
		const maxDist = Math.max(...r.distances);
		const reach = r.subMaxDist === null ? Infinity : maxDist + r.subMaxDist + 0.05;
		const subHere = subCands.filter((s) => Math.hypot(s[0] - P[0], s[2] - P[2]) <= reach);
		const subBase = receivers.length;
		receivers.push(...subHere);
		const extraBase = receivers.length;
		if (extra) receivers.push(extra.khL, extra.khR, ...(extra.sub ? [extra.sub] : []));
		if (!pairs.length && !extra) return [];
		const args = {
			source: P, receivers, durationS: r.durationS, fmax: r.fmax, planeY: null,
			onProgress: (f: number) => { if (Math.random() < 0.1) step(P, f); }
		};
		let out: RunOutput;
		if (ctx) {
			try {
				out = await runGpu(ctx, args);
			} catch {
				destroyGrid(ctx);
				ctx = null;
				device = null;
				out = run({ prep, ...args });
			}
		} else out = run({ prep, ...args });
		const tfs = out.irs.map((ir) => pointTF(ir, out.pulse, out.fs, out.K, r.freqs, r.tLate));
		// con los ajustes de partida (la fase del sub se prueba ya aquí si se puede cambiar)
		const score = (facing: number, dist: number, aperture: number, khL: V3, khR: V3, L: PointTF, R: PointTF, subs: { pos: V3; tf: PointTF }[], pols: boolean[]): Cand => {
			const mid: V3 = [(khL[0] + khR[0]) / 2, r.khY, (khL[2] + khR[2]) / 2];
			const wc = wallCriteria(plane, P[0], P[2], mid[0], mid[2]);
			const wall = { sideAsym: wc.sideAsym, near: wc.near };
			let best: Cand | null = null;
			const opts = subs.length ? subs : [null];
			for (const sb of opts)
				for (const invert of sb ? pols : [r.start.invert]) {
					const settings = { ...r.start, invert };
					const tf = { L, R, S: sb ? sb.tf : null };
					const { score: sc, parts } = scoreWith(tf, wall, settings);
					if (!best || sc > best.score)
						best = { score: sc, listener: P, facing, dist, aperture, khL, khR, sub: sb ? sb.pos : null, settings, parts, tf, wall };
				}
			return best!;
		};
		const pols = canInvert ? [false, true] : [r.start.invert];
		const here: Cand[] = [];
		pairs.forEach((p, i) => {
			const mid = [(p.khL[0] + p.khR[0]) / 2, (p.khL[2] + p.khR[2]) / 2];
			const subs = subHere
				.map((pos, j) => ({ pos, tf: tfs[subBase + j] }))
				.filter(({ pos }) => (r.subMaxDist === null || Math.hypot(pos[0] - mid[0], pos[2] - mid[1]) <= r.subMaxDist) && Math.hypot(pos[0] - P[0], pos[2] - P[2]) >= 0.4);
			here.push(score(p.facing, p.dist, p.aperture, p.khL, p.khR, tfs[2 * i], tfs[2 * i + 1], subs, pols));
		});
		// se guardan solo los 12 mejores de esta posición (el resto de respuestas se libera)
		here.sort((a, b) => b.score - a.score);
		here.length = Math.min(here.length, 12);
		if (extra) {
			const e = extraBase;
			const d = Math.hypot(extra.khL[0] - P[0], extra.khL[2] - P[2]);
			const subs = extra.sub ? [{ pos: extra.sub, tf: tfs[e + 2] }] : [];
			const mid = [(extra.khL[0] + extra.khR[0]) / 2, (extra.khL[2] + extra.khR[2]) / 2];
			const facing = (Math.atan2(mid[0] - P[0], -(mid[1] - P[2])) * 180) / Math.PI;
			const ap = (2 * Math.atan2(Math.hypot(extra.khR[0] - extra.khL[0], extra.khR[2] - extra.khL[2]) / 2, Math.hypot(mid[0] - P[0], mid[1] - P[2])) * 180) / Math.PI;
			current = score(Math.round(facing), d, Math.round(ap), extra.khL, extra.khR, tfs[e], tfs[e + 1], subs, [r.start.invert]);
		}
		return here;
	}

	/** Simula una posición de escucha; devuelve su mejor puntuación (null si no cabe ninguna colocación). */
	async function test(P: V3, extra?: OptRequest['current']): Promise<number | null> {
		const k = key(P);
		if (testedKeys.has(k) && !extra) {
			done++;
			return tested.find((t) => key(t.pos) === k)?.score ?? null;
		}
		testedKeys.add(k);
		step(P, 0);
		const here = await evaluate(P, extra);
		configs.push(...here);
		const b = here[0] ?? null;
		if (b) tested.push({ pos: P, score: b.score });
		done++;
		step(null, 1);
		await new Promise((res) => setTimeout(res, 0));
		return b ? b.score : null;
	}

	// 0) la colocación actual (para comparar)
	const curP: V3 = [r.current.listener[0], r.listenerY, r.current.listener[2]];
	const curScore = await test(curP, r.current);
	if (r.method === 'bayes') {
		// 1) unas posiciones repartidas por la sala y 2) cada siguiente donde más se espera mejorar
		phase = 'Fase 1 de 2: repartiendo las primeras posiciones por la sala';
		await bayesSearch(
			bayesCands,
			async ([x, z], ph) => {
				if (ph === 'bayes') phase = 'Fase 2 de 2: búsqueda bayesiana (simula donde más se espera mejorar)';
				return test([x, r.listenerY, z]);
			},
			{
				budget,
				nInit: Math.max(6, Math.round(0.4 * budget)),
				// tu posición actual también enseña algo al modelo (si está en la zona válida)
				taken: curScore !== null && clear(curP, 0.5) ? [{ p: [curP[0], curP[2]], y: curScore }] : []
			}
		);
	} else {
		// 1) rejilla gruesa
		phase = 'Fase 1 de 3: recorriendo la sala';
		for (const P of grid1) await test(P);
		// 2) y 3) afinado alrededor de los mejores
		const around = async (centers: V3[], d: number) => {
			for (const c of centers)
				for (const [ox, oz] of [[-d, 0], [d, 0], [0, -d], [0, d], [-d, -d], [d, -d], [-d, d], [d, d]]) {
					const P: V3 = [c[0] + ox, r.listenerY, c[2] + oz];
					if (clear(P, 0.5)) await test(P);
					else done++;
				}
		};
		phase = 'Fase 2 de 3: afinando alrededor de los 3 mejores sitios';
		await around(top().slice(0, 3).map((c) => c.listener), Math.min(0.2, r.step / 2));
		phase = 'Fase 3 de 3: ajuste fino del mejor';
		await around(top().slice(0, 1).map((c) => c.listener), Math.min(0.1, r.step / 4));
	}

	// 3) tratamiento: paneles a las primeras reflexiones y trampas de esquina a los mejores huecos
	let layout: RoomObject[] | null = null;
	let bounds: Bounds | null = null;
	const log: string[] = [];
	if (T && T.objects.length && configs.length) bounds = roomBounds(r.tris, T.nStatic, curP);
	if (T && bounds && configs.length) {
		type Placed = { o: RoomObject; mat: number };
		const geoOf = (list: Placed[]) => {
			const nS = T.nStatic;
			const pos: number[] = Array.from(r.tris.subarray(0, nS * 9));
			const mat: number[] = Array.from(r.triMat.subarray(0, nS));
			for (const { o, mat: m } of list) {
				const t = objectTris(o);
				pos.push(...t.positions);
				for (let k = 0; k < t.materials.length; k++) mat.push(m);
			}
			return { tris: Float32Array.from(pos), triMat: Int32Array.from(mat) };
		};
		const useLayout = (list: Placed[]) => {
			const g = geoOf(list);
			grid = voxelize(g, dx, r.seed);
			prep = prepare(grid, g, r.betaByMat);
			if (ctx) {
				destroyGrid(ctx);
				try {
					ctx = uploadGrid(device!, prep);
				} catch {
					ctx = null;
				}
			}
		};
		const fmtP = (p: V3) => `X ${p[0].toFixed(2).replace('.', ',')} · Y ${(-p[2]).toFixed(2).replace('.', ',')} · Z ${p[1].toFixed(2).replace('.', ',')}`;
		let placed: Placed[] = placePanels(T.objects, topCands(1)[0], bounds).map((o, i) => ({ o, mat: T.objMat[i] }));
		const moved = placed.filter((p, i) => Math.hypot(...([0, 1, 2].map((k) => p.o.pos[k] - T.objects[i].pos[k]) as [number, number, number])) > 0.05);
		for (const p of moved) log.push(`${p.o.name}: a la primera reflexión (${fmtP(p.o.pos)}).`);

		// huecos para las trampas: dentro del aire de la sala vacía (ni en la mesa ni en las paredes)
		const emptyGrid = voxelize(geoOf([]), dx, r.seed);
		const inAir = (p: V3) => {
			const c = [0, 1, 2].map((k) => Math.floor((p[k] - emptyGrid.origin[k]) / dx));
			if (c.some((v, k) => v < 0 || v >= [emptyGrid.nx, emptyGrid.ny, emptyGrid.nz][k])) return false;
			return emptyGrid.air[c[0] + emptyGrid.nx * (c[1] + emptyGrid.ny * c[2])] === 1;
		};
		const fits = (o: RoomObject) => {
			const t = objectTris({ ...o, size: o.size.map((v) => v * 0.7) as V3 }).positions;
			for (let i = 0; i < t.length; i += 3) if (!inAir([t[i], t[i + 1], t[i + 2]])) return false;
			return inAir(o.pos);
		};
		const trapIdx = placed.map((p, i) => (isCornerTrap(p.o) ? i : -1)).filter((i) => i >= 0);
		const traps = trapIdx.map((i) => placed[i].o);
		const near = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 0.05;
		const slots: Slot[] = trapSlots(traps, bounds).filter((sl) => traps.some((t) => near(t.pos, sl.pos)) || fits(atSlot(traps[0], sl)));
		// las mismas dos mejores posiciones de escucha para comparar todas las distribuciones
		const lis: V3[] = [];
		for (const c of topCands(10))
			if (lis.every((p) => Math.hypot(p[0] - c.listener[0], p[2] - c.listener[2]) > 0.3)) {
				lis.push(c.listener);
				if (lis.length === 2) break;
			}
		const evalLayout = async (list: Placed[]) => {
			useLayout(list);
			let best = -Infinity;
			for (const P of lis) {
				step(P, 0);
				const here = await evaluate(P);
				if (here[0]) best = Math.max(best, here[0].score);
				done++;
				step(null, 1);
				await new Promise((res) => setTimeout(res, 0));
			}
			return best;
		};
		if (traps.length && slots.length > traps.length) {
			const occ = trapIdx.map((i) => slots.findIndex((sl) => near(sl.pos, placed[i].o.pos)));
			const free = () => slots.map((_, j) => j).filter((j) => !occ.includes(j));
			const withTrapAt = (k: number, j: number): Placed[] => placed.map((p, i) => (i === trapIdx[k] ? { ...p, o: atSlot(p.o, slots[j]) } : p));
			const ok = (list: Placed[]) => list.every((p) => !collides(p.o, list.map((q) => q.o)));
			const nFree = free().length;
			total += lis.length * (1 + nFree + traps.length + 8);
			phase = 'Tratamiento: probando la distribución actual de las trampas';
			let base = await evalLayout(placed);
			// cuánto aporta cada hueco libre con una trampa más y cuánto se pierde al quitar cada una
			phase = 'Tratamiento: cuánto aporta cada hueco libre';
			const gainAdd = new Map<number, number>();
			for (const j of free()) {
				const extra: Placed = { o: { ...atSlot(traps[0], slots[j]), id: 'prueba' }, mat: placed[trapIdx[0]].mat };
				const list = [...placed, extra];
				gainAdd.set(j, ok(list) ? (await evalLayout(list)) - base : -Infinity);
			}
			phase = 'Tratamiento: cuánto aporta cada trampa donde está';
			const lossRem = new Map<number, number>();
			for (let k = 0; k < traps.length; k++) lossRem.set(k, base - (await evalLayout(placed.filter((_, i) => i !== trapIdx[k]))));
			// cambios más prometedores (lo que gana el hueco nuevo menos lo que pierde el viejo), comprobados de verdad
			phase = 'Tratamiento: comprobando los mejores cambios';
			const moves: { k: number; j: number; est: number }[] = [];
			for (let k = 0; k < traps.length; k++) for (const j of free()) moves.push({ k, j, est: (gainAdd.get(j) ?? -Infinity) - (lossRem.get(k) ?? 0) });
			moves.sort((a, b) => b.est - a.est);
			let tries = 0;
			for (const m of moves) {
				if (tries >= 8 || m.est < -1) break;
				if (occ.includes(m.j)) continue;
				const list = withTrapAt(m.k, m.j);
				if (!ok(list)) continue;
				tries++;
				const sc = await evalLayout(list);
				if (sc > base + 0.3) {
					log.push(`${placed[trapIdx[m.k]].o.name}: ${slots[occ[m.k]].kind} (${fmtP(slots[occ[m.k]].pos)}) → ${slots[m.j].kind} (${fmtP(slots[m.j].pos)}), +${(sc - base).toFixed(1).replace('.', ',')} puntos.`);
					placed = list;
					occ[m.k] = m.j;
					base = sc;
				}
			}
			done = Math.min(done, total);
			if (!log.some((l) => l.includes('→'))) log.push('Las trampas de esquina ya están en los mejores huecos probados: no se mueven.');
		}
		// 4) con el tratamiento nuevo, otra búsqueda (más corta) de la posición de escucha
		useLayout(placed);
		configs.length = 0;
		tested.length = 0;
		testedKeys.clear();
		const budget2 = Math.max(8, Math.round(budget / 2));
		total += lis.length + budget2;
		phase = 'Con el tratamiento nuevo: buscando otra vez la posición de escucha';
		const taken: { p: P2; y: number }[] = [];
		for (const P of lis) {
			const y = await test(P);
			if (y !== null) taken.push({ p: [P[0], P[2]], y });
		}
		const cands2: P2[] = bayesCands.length ? bayesCands : listenerGrid(BAYES_H, BAYES_H / 2).map((p) => [p[0], p[2]]);
		await bayesSearch(cands2, async ([x, z]) => test([x, r.listenerY, z]), { budget: budget2, nInit: Math.max(3, Math.round(budget2 / 3)), taken });
		// los paneles, a las primeras reflexiones de la colocación final
		layout = placePanels(placed.map((p) => p.o), topCands(1)[0], bounds);
	}
	if (ctx) destroyGrid(ctx);
	// 4) ajustes del sub sobre las 40 mejores colocaciones (sin simular: solo filtros)
	if (r.tune.length) {
		phase = 'Afinando los ajustes del sub';
		step(null, 0);
		const retune = (c: Cand): Cand => {
			const res = tuneSettings((st) => scoreWith(c.tf, c.wall, st).score, c.settings, r.tune);
			return { ...c, scoreBefore: c.score, score: res.score, settings: res.settings, parts: scoreWith(c.tf, c.wall, res.settings).parts };
		};
		const tuned = topCands(40).map(retune);
		const keep = new Set(tuned.map((c) => c.listener.join() + c.facing + c.dist + c.aperture));
		const rest = configs.filter((c) => !keep.has(c.listener.join() + c.facing + c.dist + c.aperture));
		configs.length = 0;
		configs.push(...tuned, ...rest);
		if (current) currentTuned = retune(current);
		done++;
	}
	total = done;
	post({ type: 'opt-done', elapsedS: (performance.now() - t0) / 1000, top: top(), current: strip(current), currentTuned: strip(currentTuned), tested, layout, bounds, log });
}
