// Colocación automática (KH izquierdo y derecho, sub y oyente).
//
// Idea clave: reciprocidad. La respuesta de un altavoz en A medida en B es la misma que la de una
// fuente en B medida en A. Así, con UNA simulación con la fuente en la cabeza del oyente se obtiene
// a la vez la respuesta de todas las posiciones posibles de los KH y del sub, y se pueden puntuar
// miles de combinaciones sin volver a simular. Hace falta una simulación por cada posición del oyente.
import { khResponse, subResponse, KH_SWITCHES, type Cx } from '../acoustics/speakers';
import type { V3 } from './voxel';
import type { Criterion } from '../analysis/score';

/** Respuesta compleja en un punto (normalizada: 0 dB = campo libre a 1 m), completa y tardía. */
export interface PointTF {
	re: Float32Array;
	im: Float32Array;
	lateRe: Float32Array;
	lateIm: Float32Array;
}

/** Dirección de escucha (plano horizontal) para un ángulo en grados: 0° = hacia −Z de la escena (+Y en SketchUp). */
export function facingDir(deg: number): [number, number] {
	const a = (deg * Math.PI) / 180;
	return [Math.sin(a), -Math.cos(a)];
}

/** KH delante del oyente, a `dist` m de la cabeza y a la altura `khY`, con una apertura total de
 *  `apertureDeg` (60° = triángulo equilátero). */
export function khPair(listener: V3, facingDeg: number, dist: number, khY: number, apertureDeg = 60): { khL: V3; khR: V3 } {
	const [ux, uz] = facingDir(facingDeg);
	const rx = -uz, rz = ux; // derecha del oyente
	const half = (apertureDeg / 2) * (Math.PI / 180);
	const f = dist * Math.cos(half), s = dist * Math.sin(half);
	return {
		khL: [listener[0] + f * ux - s * rx, khY, listener[2] + f * uz - s * rz],
		khR: [listener[0] + f * ux + s * rx, khY, listener[2] + f * uz + s * rz]
	};
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Partes acústicas ("maldad" 0–1) de una combinación en el punto de escucha, con la misma escala
 *  que el mapa de mejor posición. `pol` = ±1 (fase del sub). */
export function acousticParts(
	L: PointTF, R: PointTF, S: PointTF | null, gK: Cx[], gS: Cx[], pol: number
): Pick<Record<Criterion, number>, 'plano' | 'huecos' | 'picos' | 'retumbe' | 'simetria'> {
	const nF = gK.length;
	const db = new Float64Array(nF);
	let mean = 0, eFull = 0, eLate = 0, sym = 0;
	for (let k = 0; k < nF; k++) {
		const [a, b] = gK[k];
		const lr = L.re[k] + R.re[k], li = L.im[k] + R.im[k];
		let mr = lr * a - li * b, mi = lr * b + li * a;
		const tlr = L.lateRe[k] + R.lateRe[k], tli = L.lateIm[k] + R.lateIm[k];
		let tr = tlr * a - tli * b, ti = tlr * b + tli * a;
		if (S) {
			const c = gS[k][0] * pol, d = gS[k][1] * pol;
			mr += S.re[k] * c - S.im[k] * d;
			mi += S.re[k] * d + S.im[k] * c;
			tr += S.lateRe[k] * c - S.lateIm[k] * d;
			ti += S.lateRe[k] * d + S.lateIm[k] * c;
		}
		const p = mr * mr + mi * mi;
		db[k] = 10 * Math.log10(p + 1e-20);
		mean += db[k];
		eFull += p;
		eLate += tr * tr + ti * ti;
		const pl = L.re[k] ** 2 + L.im[k] ** 2, pr = R.re[k] ** 2 + R.im[k] ** 2;
		sym += Math.abs(10 * Math.log10((pl + 1e-20) / (pr + 1e-20)));
	}
	mean /= nF;
	let sq = 0, holes = 0, peaks = 0;
	for (let k = 0; k < nF; k++) {
		const dev = db[k] - mean;
		sq += dev * dev;
		holes += Math.max(0, -dev - 6);
		peaks += Math.max(0, dev - 6);
	}
	return {
		plano: clamp01(Math.sqrt(sq / nF) / 6),
		huecos: clamp01(holes / nF / 4),
		picos: clamp01(peaks / nF / 4),
		retumbe: clamp01((10 * Math.log10((eLate + 1e-20) / (eFull + 1e-20)) + 30) / 20),
		simetria: clamp01(sym / nF / 3) // solo la parte de grave; la geométrica se suma fuera
	};
}

/** Puntuación 0–100 con los pesos del usuario (sin robustez ni geometría: el triángulo es fijo). */
export function totalScore(parts: Partial<Record<OptCriterion, number>>, weights: Partial<Record<OptCriterion, number>>): number {
	let bad = 0, wsum = 0;
	for (const k of Object.keys(parts) as OptCriterion[]) {
		const w = weights[k] ?? 0;
		bad += w * (parts[k] ?? 0);
		wsum += w;
	}
	return 100 * (1 - bad / (wsum || 1));
}

/** Ajustes que se pueden tocar sin mover nada: los del Sub8 (corte, nivel, fase y filtro de 85 Hz
 *  de las salidas a satélites) y, cuando se active KH_EQ, los interruptores Bass y Low-Mid de los KH. */
export interface Settings {
	xoverHz: number;
	gainDb: number;
	invert: boolean;
	hpf85: boolean;
	bassDb: number;
	lowMidDb: number;
}

export const SETTING_VALUES: { [K in keyof Settings]: Settings[K][] } = {
	xoverHz: [50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150],
	gainDb: [-10, -9, -8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6],
	invert: [false, true],
	hpf85: [false, true],
	bassDb: [...KH_SWITCHES.bassDb],
	lowMidDb: [...KH_SWITCHES.lowMidDb]
};

/** Respuestas de KH y sub por frecuencia para unos ajustes (con caché: se repiten mucho). */
export class GainCache {
	private kh = new Map<string, Cx[]>();
	private sub = new Map<string, Cx[]>();
	constructor(private freqs: number[], private subDelayMs = 0) {}
	gK(s: Settings): Cx[] {
		const k = `${s.hpf85}|${s.bassDb}|${s.lowMidDb}`;
		let v = this.kh.get(k);
		if (!v) this.kh.set(k, (v = this.freqs.map((f) => khResponse(f, { satHpf85: s.hpf85, bassDb: s.bassDb, lowMidDb: s.lowMidDb }))));
		return v;
	}
	/** sin invertir: la fase se aplica aparte (pol = ±1) */
	gS(s: Settings): Cx[] {
		const k = `${s.xoverHz}|${s.gainDb}`;
		let v = this.sub.get(k);
		if (!v)
			this.sub.set(k, (v = this.freqs.map((f) => subResponse(f, { enabled: true, xoverHz: s.xoverHz, gainDb: s.gainDb, polarityInvert: false, extraDelayMs: this.subDelayMs }))));
		return v;
	}
}

/** Busca los mejores ajustes. Si las combinaciones son pocas (los del sub son 11 × 17 × 2 × 2 = 748, y
 *  evaluar cada una cuesta microsegundos) las prueba todas: óptimo garantizado. Si son demasiadas, usa
 *  descenso por coordenadas (cambia un ajuste cada vez mientras mejore), que es mucho más rápido pero
 *  puede quedarse en un óptimo local. */
export function tuneSettings(
	evaluate: (s: Settings) => number,
	start: Settings,
	keys: (keyof Settings)[],
	maxExhaustive = 20000,
	maxRounds = 6
): { settings: Settings; score: number; evals: number } {
	let best = { ...start };
	let bestScore = evaluate(best);
	let evals = 1;
	const combos = keys.reduce((n, k) => n * SETTING_VALUES[k].length, 1);
	if (combos <= maxExhaustive) {
		const rec = (i: number, s: Settings) => {
			if (i === keys.length) {
				const sc = evaluate(s);
				evals++;
				if (sc > bestScore + 1e-9) {
					best = s;
					bestScore = sc;
				}
				return;
			}
			for (const v of SETTING_VALUES[keys[i]] as (number | boolean)[]) rec(i + 1, { ...s, [keys[i]]: v } as Settings);
		};
		rec(0, { ...start });
		return { settings: best, score: bestScore, evals };
	}
	for (let round = 0; round < maxRounds; round++) {
		let improved = false;
		for (const k of keys) {
			for (const v of SETTING_VALUES[k] as (number | boolean)[]) {
				if (best[k] === v) continue;
				const cand = { ...best, [k]: v } as Settings;
				const sc = evaluate(cand);
				evals++;
				if (sc > bestScore + 1e-9) {
					best = cand;
					bestScore = sc;
					improved = true;
				}
			}
		}
		if (!improved) break;
	}
	return { settings: best, score: bestScore, evals };
}

export interface OptConfig {
	score: number;
	listener: V3;
	facing: number;
	dist: number;
	aperture: number;
	settings: Settings;
	/** puntuación antes de afinar los ajustes (con los de partida) */
	scoreBefore?: number;
	khL: V3;
	khR: V3;
	sub: V3 | null;
	parts: Partial<Record<OptCriterion, number>>;
}

/** Criterios de la colocación automática: los de «Mejor posición» y, en el modo ULTRA, las reflexiones
 *  tempranas de medios y agudos (método de la imagen con difracción, con el tratamiento colocado). */
export type OptCriterion = Criterion | 'reflexiones';
