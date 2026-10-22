// Orquestación de la simulación desde el hilo principal.
import { app, emptyOpt, type DeviceId, type SimResult } from '../state.svelte';
import { roomTF, combine, type Spectrum } from '../dsp/analysis';
import { khResponse, subResponse, cmul, KH_EQ, type Cx } from '../acoustics/speakers';
import type { RunRequest, WorkerMsg, LevelResult, LevelSpec, FramesChunk, OptRequest } from './sim.worker';
import type { OptConfig, Settings } from './optimize';
import { anim, animData, mapFMax } from '../mapAnim.svelte';
import SimWorker from './sim.worker?worker';
import type { V3 } from './voxel';
import { placePanels } from './treatment';

let worker: Worker | null = null;
let mapReq = 0;
const mapWaiters = new Map<number, (m: Extract<WorkerMsg, { type: 'map' }>) => void>();

function getWorker(): Worker {
	if (worker) return worker;
	worker = new SimWorker();
	worker.onmessage = (ev: MessageEvent<WorkerMsg>) => {
		const m = ev.data;
		if (m.type === 'progress') app.progress = { stage: m.stage, frac: (m.level + m.frac) / m.nLevels };
		else if (m.type === 'error') {
			app.error = m.message;
			app.running = false;
		} else if (m.type === 'level') onLevel(m);
		else if (m.type === 'map') mapWaiters.get(m.reqId)?.(m), mapWaiters.delete(m.reqId);
		else if (m.type === 'frames') onFrames(m);
	};
	worker.onerror = (e) => {
		e.preventDefault();
		if (e.message || !app.running) {
			app.error = e.message || 'Error en el cálculo';
			app.running = false;
			return;
		}
		// sin mensaje: el navegador cortó el cálculo (falta de memoria, la tarjeta gráfica se reinició…).
		// Se reintenta una vez con el procesador.
		if (!simRetried) return runSimulation(true);
		app.error =
			'El navegador cortó el cálculo sin dar motivo (suele ser falta de memoria o un reinicio de la tarjeta gráfica). Prueba con menos frecuencia máxima o menos puntos por longitud de onda, o cierra otras pestañas y programas.';
		app.running = false;
	};
	return worker;
}
let simRetried = false;

let pendingNames: string[] = [];
let pendingPositions: Record<DeviceId, V3> | null = null;
let pendingReceivers: V3[] = [];

/** Escalera de niveles: vistas previas rápidas y, al final, la frecuencia máxima elegida. */
export function levelLadder(fmax: number, durationS: number): LevelSpec[] {
	const steps = [100, 160, 250, 350].filter((f) => f < fmax * 0.9);
	return [...steps.map((f) => ({ fmax: f, durationS: Math.min(durationS, 1.0) })), { fmax, durationS }];
}

/** Lanza (o relanza) la simulación progresiva. Cancela cualquier cálculo en curso.
 *  `retry`: segundo intento tras cortarse el cálculo sin dar motivo (va con el procesador). */
export function runSimulation(retry = false) {
	simRetried = retry;
	app.error = null;
	const inp = app.simInput();
	// un worker nuevo por ejecución: cancelar = terminar el anterior
	worker?.terminate();
	worker = null;
	resetFrames();
	pendingNames = inp.names;
	pendingPositions = app.snapshotPositions();
	pendingReceivers = inp.receivers;
	app.running = true;
	app.progress = { stage: retry ? 'Se cortó el cálculo: reintentando con el procesador' : 'Preparando', frac: 0 };
	const req: RunRequest = {
		type: 'run', tris: inp.tris, triMat: inp.triMat, betaByMat: inp.betaByMat,
		levels: levelLadder(inp.fmax, inp.durationS), ppw: inp.ppw,
		seed: inp.seed, sources: inp.sources, receivers: inp.receivers, planeY: inp.planeY,
		engine: retry ? 'cpu' : app.engine, tLate: 0.12
	};
	try {
		getWorker().postMessage(req, [req.tris.buffer, req.triMat.buffer]);
	} catch (e) {
		app.running = false;
		app.progress = { stage: '', frac: 0 };
		throw e;
	}
}

export function cancelSimulation() {
	worker?.terminate();
	worker = null;
	app.running = false;
	app.progress = { stage: 'Cancelado', frac: 0 };
}

function onLevel(m: LevelResult) {
	const fmax = m.fmax;
	const tf: Record<string, Spectrum[]> = {};
	for (const r of m.results) tf[r.id] = r.irs.map((ir) => roomTF(ir, m.pulse, m.fs, m.K, fmax));
	const areaByMat = new Map<string, number>();
	for (const [mi, a] of m.areaByMat) areaByMat.set(mi >= 0 ? pendingNames[mi] : '(exterior/otros)', a);
	const res: SimResult = {
		fs: m.fs, fmax, K: m.K,
		grid: { nx: m.grid.nx, ny: m.grid.ny, nz: m.grid.nz, dx: m.grid.dx, airVolume: m.grid.airVolume, leak: m.grid.leak, leakPoint: m.grid.leakPoint },
		tf, receivers: pendingReceivers, areaByMat,
		plane: m.plane ? { nx: m.plane.nx, nz: m.plane.nz, y: m.plane.y, dx: m.grid.dx, origin: m.grid.origin } : null,
		elapsedS: m.elapsedS,
		positionsAtRun: pendingPositions!
	};
	app.result = res;
	app.spectra = m.spectra;
	app.hoverCell = -1;
	app.level = { i: m.level, n: m.nLevels, fmax, engine: m.engine, dx: m.grid.dx };
	if (m.level === m.nLevels - 1) {
		app.running = false;
		app.progress = { stage: `Hecho: ${m.nLevels} niveles, el último hasta ${fmax} Hz`, frac: 1 };
		// en segundo plano: el barrido del mapa para la animación
		if (m.plane) requestFrames(20, mapFMax(fmax));
	}
}

let framesReq = 0;
function resetFrames() {
	anim.reqId = ++framesReq;
	anim.ready = 0;
	anim.total = 0;
}

/** Pide al worker el barrido completo del mapa (1/48 de octava), que llega por bloques. */
export function requestFrames(fLo: number, fHi: number) {
	if (!worker) return;
	resetFrames();
	worker.postMessage({ type: 'frames', reqId: anim.reqId, fLo, fHi, perOctave: 48 });
}

function onFrames(m: FramesChunk) {
	if (m.reqId !== anim.reqId) return;
	const nC = m.nCells, len = m.re[0].length / nC;
	if (m.start === 0) {
		Object.assign(animData, {
			freqs: m.freqs, ids: m.ids, nCells: nC, ix: m.ix, iz: m.iz, nx: m.nx, nz: m.nz,
			re: m.ids.map(() => new Float32Array(m.total * nC)), im: m.ids.map(() => new Float32Array(m.total * nC))
		});
	}
	m.ids.forEach((_, s) => {
		animData.re[s].set(m.re[s], m.start * nC);
		animData.im[s].set(m.im[s], m.start * nC);
	});
	anim.total = m.total;
	anim.ready = m.start + len;
}

/** Respuesta eléctrica-acústica de cada fuente (altavoz + cruce), por canal reproducido. */
export function sourceGain(id: string, f: number, channel: 'L' | 'R' | 'mono'): Cx {
	const kh = khResponse(f, app.kh);
	if (id === 'khL') return channel === 'R' ? [0, 0] : kh;
	if (id === 'khR') return channel === 'L' ? [0, 0] : kh;
	if (id === 'sub') {
		// el Sub8 recibe (L+R)/2: con un solo canal le llega la mitad
		const s = subResponse(f, app.sub);
		const k = channel === 'mono' ? 1 : 0.5;
		return [s[0] * k, s[1] * k];
	}
	return [0, 0];
}

/** Espectro total en un receptor para un canal. */
export function systemSpectrum(res: SimResult, rcv: number, channel: 'L' | 'R' | 'mono', withSub = true): Spectrum {
	const parts = Object.keys(res.tf)
		.filter((id) => withSub || id !== 'sub')
		.map((id) => ({ tf: res.tf[id][rcv], spk: (f: number) => sourceGain(id, f, channel) }));
	return combine(parts);
}

/** Mapa del plano de escucha a una frecuencia (o banda de 1/3 oct) para la reproducción mono. */
export function requestMap(fc: number, band: boolean): Promise<Extract<WorkerMsg, { type: 'map' }>> {
	const freqs = band ? Array.from({ length: 7 }, (_, i) => fc * Math.pow(2, (i - 3) / 18)) : [fc];
	const ids = app.result ? Object.keys(app.result.tf) : [];
	const gains: Record<string, Cx[]> = {};
	for (const id of ids) gains[id] = freqs.map((f) => sourceGain(id, f, 'mono'));
	const reqId = ++mapReq;
	return new Promise((resolve) => {
		mapWaiters.set(reqId, resolve);
		getWorker().postMessage({ type: 'map', reqId, freqs, gains });
	});
}

/** Coloca los KH en triángulo equilátero respecto al oyente (mirando hacia -Z). */
export function placeTriangle(distance: number, speakerHeight: number) {
	const L = app.positions.listener;
	const half = distance / 2;
	const depth = distance * Math.cos(Math.PI / 6);
	app.positions.khL = [L[0] - half, speakerHeight, L[2] - depth];
	app.positions.khR = [L[0] + half, speakerHeight, L[2] - depth];
}

/** Posiciones iniciales razonables tras importar un modelo (a partir de su caja envolvente). */
export function autoPlace() {
	if (!app.bbox) return;
	const { min, max } = app.bbox;
	const cx = (min[0] + max[0]) / 2;
	const floor = min[1];
	const depth = max[2] - min[2];
	app.positions.listener = [cx, floor + 1.2, min[2] + 0.38 * depth + 1.04];
	placeTriangle(1.2, floor + 1.2);
	const kl = app.positions.khL;
	app.positions.sub = [kl[0], floor + 0.2, kl[2]];
}

export { cmul };

// ── Colocación automática ─────────────────────────────────────────────────────────
let optWorker: Worker | null = null;

/** ppw y rejilla de cada precisión; `bayes`: cuántas posiciones simula la búsqueda bayesiana
 *  (base + por m² de zona válida, con un máximo). Con la sala de prueba simula ~1/3 que la rejilla. */
const PRECISION = {
	rapida: { ppw: 7, step: 0.6, bayes: { base: 10, perM2: 1, max: 40 } },
	normal: { ppw: 8, step: 0.45, bayes: { base: 14, perM2: 1.6, max: 60 } },
	fina: { ppw: 10, step: 0.3, bayes: { base: 18, perM2: 2.4, max: 90 } }
} as const;

/** Lanza la búsqueda de la mejor colocación (en un worker aparte: no toca la simulación normal).
 *  `retry`: segundo intento tras caerse el worker sin dar motivo (va con el procesador). */
export function runOptimize(retry = false) {
	cancelOptimize();
	const inp = app.simInput();
	const P = app.snapshotPositions();
	const o = app.optOptions;
	const prec = PRECISION[o.precision];
	const [bLo, bHi] = app.band;
	const fmax = Math.round(Math.min(300, Math.max(150, bHi / 0.8)));
	const freqs: number[] = [];
	for (let f = bLo; f <= Math.min(bHi, 0.8 * fmax) * 1.0001; f *= Math.pow(2, 1 / 24)) freqs.push(f);
	// copias planas (las runas $state.snapshot solo existen en archivos .svelte/.svelte.ts)
	const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));
	const sub = plain(app.sub);
	const kh = plain(app.kh);
	// ajustes actuales (punto de partida) y cuáles puede cambiar el optimizador
	const start: Settings = {
		xoverHz: sub.xoverHz, gainDb: sub.gainDb, invert: sub.polarityInvert, hpf85: kh.satHpf85,
		bassDb: kh.bassDb ?? 0, lowMidDb: kh.lowMidDb ?? 0
	};
	const tune: (keyof Settings)[] = [];
	if (app.sub.enabled) tune.push('invert'); // la fase se ha probado siempre: es un conmutador
	if (app.sub.enabled && o.tuneSub) tune.push('xoverHz', 'gainDb', 'hpf85');
	if (KH_EQ.enabled && o.tuneKh) tune.push('bassDb', 'lowMidDb');
	const mid = [(P.khL[0] + P.khR[0]) / 2, (P.khL[2] + P.khR[2]) / 2];
	const curFacing = Math.round((Math.atan2(mid[0] - P.listener[0], -(mid[1] - P.listener[2])) * 180) / Math.PI);
	const distances: number[] = [];
	for (let d = Math.max(0.8, app.listenRange[0]); d <= Math.min(2.0, app.listenRange[1]) + 1e-6; d += 0.1) distances.push(Math.round(d * 100) / 100);
	const req: OptRequest = {
		type: 'optimize', tris: inp.tris, triMat: inp.triMat, betaByMat: inp.betaByMat, seed: inp.seed,
		fmax, ppw: prec.ppw, durationS: 1.0, engine: retry ? 'cpu' : app.engine, tLate: 0.12,
		listenerY: P.listener[1], khY: P.khL[1], subY: P.sub[1], subEnabled: app.sub.enabled,
		freqs, start, tune, subDelayMs: sub.extraDelayMs ?? 0, weights: plain(app.weights), distances,
		apertures: o.apertures === 'varias' ? [50, 60, 70] : [60],
		facings: o.facings === 'todas' ? [0, 90, 180, 270] : [curFacing],
		subMaxDist: o.sub === 'cerca' ? 1.5 : null, step: prec.step, method: o.method, bayes: { ...prec.bayes },
		treatment: o.treatment && inp.objects.length ? { nStatic: inp.nStatic, objects: plain(inp.objects), objMat: inp.objMat } : null,
		current: { listener: P.listener, khL: P.khL, khR: P.khR, sub: app.sub.enabled ? P.sub : null }
	};
	app.opt = { ...emptyOpt(), running: true, phase: retry ? 'Se cortó el cálculo: reintentando con el procesador' : 'Preparando la sala' };
	optWorker = new SimWorker();
	optWorker.onmessage = (ev: MessageEvent<WorkerMsg>) => {
		const m = ev.data;
		if (m.type === 'opt-start') app.opt = { ...app.opt, footprint: { mask: m.mask, nx: m.nx, nz: m.nz, dx: m.dx, origin: m.origin }, total: m.total, engine: m.engine, nSub: m.nSub };
		else if (m.type === 'opt-step') app.opt = { ...app.opt, done: m.done, total: m.total, phase: m.phase, frac: m.frac, testing: m.testing, tested: m.tested, top: m.top, current: m.current };
		else if (m.type === 'opt-done') {
			app.opt = {
				...app.opt, running: false, testing: null, top: m.top, current: m.current, currentTuned: m.currentTuned, tested: m.tested,
				done: app.opt.total, phase: 'Terminado', elapsedS: m.elapsedS, layout: m.layout, bounds: m.bounds, log: m.log
			};
			optWorker?.terminate();
			optWorker = null;
		} else if (m.type === 'error') app.opt = { ...app.opt, running: false, error: m.message };
	};
	optWorker.onerror = (e) => {
		e.preventDefault();
		if (e.message) {
			app.opt = { ...app.opt, running: false, error: e.message };
			return;
		}
		// sin mensaje: el worker no llegó a arrancar o el navegador lo cortó (falta de memoria, la tarjeta
		// gráfica se reinició…). Se reintenta una vez, con el procesador.
		optWorker?.terminate();
		optWorker = null;
		if (!retry) return runOptimize(true);
		app.opt = {
			...app.opt, running: false,
			error: 'El navegador cortó la búsqueda sin dar motivo (suele ser falta de memoria o un reinicio de la tarjeta gráfica). Prueba con Precisión «Normal» o cierra otras pestañas y programas.'
		};
	};
	optWorker.postMessage(req, [req.tris.buffer, req.triMat.buffer]);
}

export function cancelOptimize() {
	optWorker?.terminate();
	optWorker = null;
	if (app.opt.running) app.opt = { ...app.opt, running: false, testing: null, phase: 'Detenido' };
}

/** Aplica una combinación encontrada: posiciones (se vuelve a simular sola), ajustes del sub
 *  (al instante, sin simular) y, si la búsqueda movió el tratamiento, trampas y paneles (los paneles, a
 *  las primeras reflexiones de esta combinación). */
export function applyConfig(c: OptConfig) {
	const { layout, bounds } = app.opt;
	if (layout && bounds && c !== app.opt.currentTuned) app.objects = placePanels(layout, c, bounds);
	const r = (v: number) => Math.round(v * 1000) / 1000;
	const rv = (p: V3): V3 => [r(p[0]), r(p[1]), r(p[2])];
	app.positions.listener = rv(c.listener);
	app.positions.khL = rv(c.khL);
	app.positions.khR = rv(c.khR);
	if (c.sub) app.positions.sub = rv(c.sub);
	const st = c.settings;
	if (app.sub.enabled) {
		app.sub.xoverHz = st.xoverHz;
		app.sub.gainDb = st.gainDb;
		app.sub.polarityInvert = st.invert;
		app.kh.satHpf85 = st.hpf85;
	}
	if (KH_EQ.enabled) {
		app.kh.bassDb = st.bassDb;
		app.kh.lowMidDb = st.lowMidDb;
	}
}
