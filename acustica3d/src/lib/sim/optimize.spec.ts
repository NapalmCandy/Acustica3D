import { describe, it, expect, afterEach } from 'vitest';
import { tuneSettings, GainCache, acousticParts, totalScore, khPair, SETTING_VALUES, type Settings, type PointTF } from './optimize';
import { khResponse, KH_EQ, cabs } from '../acoustics/speakers';
import { DEFAULT_WEIGHTS } from '../analysis/score';

const START: Settings = { xoverHz: 100, gainDb: 0, invert: false, hpf85: false, bassDb: 0, lowMidDb: 0 };
const freqs: number[] = [];
for (let f = 30; f <= 200; f *= Math.pow(2, 1 / 24)) freqs.push(f);

/** respuesta de la sala en un punto: ganancia en dB por frecuencia, sin fase (campo directo idealizado) */
const tf = (db: (f: number) => number): PointTF => {
	const n = freqs.length;
	const re = new Float32Array(n), z = new Float32Array(n), late = new Float32Array(n).fill(1e-4);
	freqs.forEach((f, k) => (re[k] = Math.pow(10, db(f) / 20)));
	return { re, im: z, lateRe: late, lateIm: z };
};
const W = { ...DEFAULT_WEIGHTS };
const scorer = (L: PointTF, R: PointTF, S: PointTF | null) => {
	const gc = new GainCache(freqs);
	return (s: Settings) => totalScore(acousticParts(L, R, S, gc.gK(s), gc.gS(s), s.invert ? -1 : 1), W);
};

describe('ajustes del sub (y de los KH cuando se active su EQ)', () => {
	afterEach(() => {
		KH_EQ.enabled = true;
	});

	it('el descenso por coordenadas (para cuando hay demasiadas combinaciones) encuentra el óptimo de una función suave', () => {
		const res = tuneSettings((s) => -((s.xoverHz - 80) ** 2) / 100 - (s.gainDb + 3) ** 2 - (s.invert ? 0 : 5), START, ['xoverHz', 'gainDb', 'invert'], 0);
		expect(res.settings.xoverHz).toBe(80);
		expect(res.settings.gainDb).toBe(-3);
		expect(res.settings.invert).toBe(true);
		expect(res.evals).toBeLessThan(200); // muy por debajo de las 11 × 17 × 2 = 374 combinaciones
	});

	/** el mejor resultado posible probando todas las combinaciones de los ajustes indicados */
	const bruteForce = (ev: (s: Settings) => number, keys: (keyof Settings)[]) => {
		let best = -Infinity, n = 0;
		const rec = (i: number, s: Settings) => {
			if (i === keys.length) {
				best = Math.max(best, ev(s));
				n++;
				return;
			}
			for (const v of SETTING_VALUES[keys[i]] as (number | boolean)[]) rec(i + 1, { ...s, [keys[i]]: v } as Settings);
		};
		rec(0, START);
		return { best, n };
	};

	it('ajustes del sub: como son pocas combinaciones, las prueba todas y da el óptimo exacto', () => {
		const keys: (keyof Settings)[] = ['xoverHz', 'gainDb', 'invert', 'hpf85'];
		const kh = tf((f) => (f > 70 && f < 110 ? -9 : 0)); // hueco de los KH en su sitio
		const scenarios = [
			tf((f) => (f < 90 ? 10 : 0)), // rincón: refuerza mucho el grave del sub
			tf((f) => (f < 60 ? -6 : 4)), // al revés
			tf(() => -12) // sub lejos y flojo
		];
		for (const sub of scenarios) {
			const ev = scorer(kh, kh, sub);
			const res = tuneSettings(ev, START, keys);
			const bf = bruteForce(ev, keys);
			expect(res.score).toBeCloseTo(bf.best, 9);
			expect(res.score).toBeGreaterThanOrEqual(ev(START));
		}
	});

	it('la EQ de los KH recorta Bass si la pared refuerza su grave', () => {
		const wall = tf((f) => (f > 55 && f < 150 ? 6 : 0)); // la pared refuerza 6 dB entre ~55 y 150 Hz
		const ev = scorer(wall, wall, null);
		const res = tuneSettings(ev, START, ['bassDb', 'lowMidDb']);
		expect(res.settings.bassDb + res.settings.lowMidDb).toBeLessThan(0);
		expect(res.score).toBeGreaterThan(ev(START));
		expect(res.score).toBeCloseTo(bruteForce(ev, ['bassDb', 'lowMidDb']).best, 9);
	});

	it('los interruptores del KH siguen la gráfica del manual de Neumann (pág. 25)', () => {
		const eff = (f: number, o: { bassDb?: number; lowMidDb?: number; trebleDb?: number }) =>
			20 * Math.log10(cabs(khResponse(f, { satHpf85: false, ...o })) / cabs(khResponse(f, { satHpf85: false })));
		// puntos leídos de los trazos vectoriales del manual (curva menos la de referencia)
		const manual: [number, { bassDb?: number; lowMidDb?: number; trebleDb?: number }, number][] = [
			[40, { bassDb: -7.5 }, -7.43], [101, { bassDb: -7.5 }, -6.2], [202, { bassDb: -7.5 }, -3.1], [508, { bassDb: -7.5 }, -0.47],
			[101, { bassDb: -2.5 }, -2.24], [202, { bassDb: -5 }, -2.1],
			[101, { lowMidDb: -4.5 }, -2.45], [254, { lowMidDb: -4.5 }, -4.47], [1016, { lowMidDb: -4.5 }, -1.82],
			[202, { lowMidDb: -1.5 }, -1.59]
		];
		for (const [f, o, db] of manual) expect(Math.abs(eff(f, o) - db)).toBeLessThan(0.45);
		// apagada, no hacen nada
		KH_EQ.enabled = false;
		expect(eff(60, { bassDb: -7.5, lowMidDb: -4.5 })).toBeCloseTo(0, 9);
	});

	it('apertura de los KH: 60° es equilátero y 70° los separa más', () => {
		const L: [number, number, number] = [0, 1.2, 0];
		const sep = (ap: number) => {
			const { khL, khR } = khPair(L, 0, 1.2, 1.2, ap);
			return Math.hypot(khR[0] - khL[0], khR[2] - khL[2]);
		};
		expect(sep(60)).toBeCloseTo(1.2, 6);
		expect(sep(70)).toBeGreaterThan(sep(60));
		expect(sep(50)).toBeLessThan(sep(60));
	});
});
