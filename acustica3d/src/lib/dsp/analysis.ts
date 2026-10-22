// Análisis de las respuestas simuladas: funciones de transferencia, suavizado, decaimiento y mapas.
import { rfft, irfft, nextPow2 } from './fft';
import type { Cx } from '../acoustics/speakers';

export interface Spectrum {
	fs: number;
	n: number; // tamaño FFT
	re: Float64Array; // n/2+1
	im: Float64Array;
	fmax: number; // límite de validez
}

/** Función de transferencia sala (fuente→receptor), 0 dB = campo libre a 1 m. Se anula por encima de fmax. */
export function roomTF(ir: Float32Array, pulse: Float32Array, fs: number, K: number, fmax: number): Spectrum {
	const n = nextPow2(ir.length * 2);
	const P = rfft(ir, n);
	const S = rfft(pulse, n);
	const re = new Float64Array(n / 2 + 1);
	const im = new Float64Array(n / 2 + 1);
	const f0 = 0.85 * fmax;
	for (let k = 1; k <= n / 2; k++) {
		const f = (k * fs) / n;
		if (f > fmax) break;
		const sr = S.re[k] * K;
		const si = S.im[k] * K;
		const d = sr * sr + si * si;
		if (d < 1e-30) continue;
		let r = (P.re[k] * sr + P.im[k] * si) / d;
		let i = (P.im[k] * sr - P.re[k] * si) / d;
		// atenuación suave al acercarse al límite de validez
		if (f > f0) {
			const w = 0.5 + 0.5 * Math.cos((Math.PI * (f - f0)) / (fmax - f0));
			r *= w;
			i *= w;
		}
		re[k] = r;
		im[k] = i;
	}
	return { fs, n, re, im, fmax };
}

/** Combina varias funciones de transferencia con sus respuestas de altavoz: Σ H_room·H_spk(f). */
export function combine(parts: { tf: Spectrum; spk: (f: number) => Cx }[]): Spectrum {
	const { fs, n, fmax } = parts[0].tf;
	const re = new Float64Array(n / 2 + 1);
	const im = new Float64Array(n / 2 + 1);
	for (let k = 1; k <= n / 2; k++) {
		const f = (k * fs) / n;
		if (f > fmax) break;
		for (const p of parts) {
			const h = p.spk(f);
			const a = p.tf.re[k], b = p.tf.im[k];
			re[k] += a * h[0] - b * h[1];
			im[k] += a * h[1] + b * h[0];
		}
	}
	return { fs, n, re, im, fmax };
}

/** Curva de magnitud en dB en frecuencias logarítmicas, con suavizado de 1/frac octava (0 = sin suavizar). */
export function magnitudeCurve(sp: Spectrum, fLo: number, fHi: number, perOct = 48, frac = 0): { f: number[]; db: number[] } {
	const f: number[] = [];
	const db: number[] = [];
	const nPts = Math.floor(Math.log2(fHi / fLo) * perOct) + 1;
	const df = sp.fs / sp.n;
	const pow = (k: number) => sp.re[k] * sp.re[k] + sp.im[k] * sp.im[k];
	for (let i = 0; i < nPts; i++) {
		const fc = fLo * Math.pow(2, i / perOct);
		let p: number;
		if (frac > 0) {
			const a = Math.max(1, Math.floor((fc * Math.pow(2, -0.5 / frac)) / df));
			const b = Math.max(a, Math.ceil((fc * Math.pow(2, 0.5 / frac)) / df));
			let s = 0;
			for (let k = a; k <= b; k++) s += pow(k);
			p = s / (b - a + 1);
		} else {
			// interpolación lineal entre bins
			const x = fc / df;
			const k = Math.floor(x);
			const t = x - k;
			p = (1 - t) * pow(k) + t * pow(k + 1);
		}
		f.push(fc);
		db.push(10 * Math.log10(Math.max(p, 1e-20)));
	}
	return { f, db };
}

/** Respuesta al impulso (real) a partir de un espectro. */
export function toIR(sp: Spectrum): Float64Array {
	return irfft(sp.re, sp.im, sp.n);
}

/** Banda de 1/3 de octava aplicada en frecuencia (filtro de fase cero) → IR filtrada. */
function bandIR(sp: Spectrum, fc: number): Float64Array {
	const re = new Float64Array(sp.re.length);
	const im = new Float64Array(sp.im.length);
	const lo = fc * Math.pow(2, -1 / 6);
	const hi = fc * Math.pow(2, 1 / 6);
	for (let k = 0; k < re.length; k++) {
		const f = (k * sp.fs) / sp.n;
		// flancos suaves (Butterworth de 6.º orden en magnitud)
		const g = 1 / Math.sqrt(1 + Math.pow(lo / Math.max(f, 1e-6), 12)) / Math.sqrt(1 + Math.pow(f / hi, 12));
		re[k] = sp.re[k] * g;
		im[k] = sp.im[k] * g;
	}
	return irfft(re, im, sp.n);
}

export interface DecayBand {
	fc: number;
	edt: number | null;
	t20: number | null;
	t30: number | null;
	curve: { t: number[]; db: number[] }; // curva de Schroeder (diezmada)
}

function regressT(t: number[], db: number[], from: number, to: number): number | null {
	// tiempo para caer 60 dB a partir de la regresión entre 'from' y 'to' dB
	const xs: number[] = [];
	const ys: number[] = [];
	for (let i = 0; i < t.length; i++) if (db[i] <= from && db[i] >= to) { xs.push(t[i]); ys.push(db[i]); }
	if (xs.length < 4) return null;
	const n = xs.length;
	const mx = xs.reduce((a, b) => a + b, 0) / n;
	const my = ys.reduce((a, b) => a + b, 0) / n;
	let sxy = 0, sxx = 0;
	for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
	const slope = sxy / sxx;
	if (slope >= -1e-6) return null;
	return -60 / slope;
}

/** Tiempos de reverberación por tercios de octava (integral de Schroeder). */
export function decayBands(sp: Spectrum, bands: number[], maxT = 2.0): DecayBand[] {
	return bands.map((fc) => {
		const h = bandIR(sp, fc);
		const nT = Math.min(h.length, Math.floor(maxT * sp.fs));
		const e = new Float64Array(nT);
		let acc = 0;
		for (let i = nT - 1; i >= 0; i--) { acc += h[i] * h[i]; e[i] = acc; }
		const e0 = e[0] || 1e-30;
		const t: number[] = [];
		const db: number[] = [];
		const stride = Math.max(1, Math.floor(sp.fs / 1000));
		for (let i = 0; i < nT; i += stride) {
			t.push(i / sp.fs);
			db.push(10 * Math.log10(Math.max(e[i] / e0, 1e-12)));
		}
		return {
			fc,
			edt: regressT(t, db, 0, -10),
			t20: regressT(t, db, -5, -25),
			t30: regressT(t, db, -5, -35),
			curve: { t, db }
		};
	});
}

/** Cascada de decaimiento (STFT con ventana deslizante desde el inicio): matriz [tiempos][frecuencias] en dB. */
export function waterfall(sp: Spectrum, fLo: number, fHi: number, opts = { winMs: 120, stepMs: 10, maxMs: 600, perOct: 24 }) {
	const h = toIR(sp);
	const fs = sp.fs;
	const win = Math.floor((opts.winMs / 1000) * fs);
	const step = Math.max(1, Math.floor((opts.stepMs / 1000) * fs));
	const nSteps = Math.floor((opts.maxMs / opts.stepMs)) + 1;
	const nfft = nextPow2(win * 4);
	const freqs: number[] = [];
	for (let f = fLo; f <= fHi; f *= Math.pow(2, 1 / opts.perOct)) freqs.push(f);
	const rows: number[][] = [];
	const times: number[] = [];
	// el inicio: pico de la IR menos un pequeño margen
	let pk = 0;
	for (let i = 1; i < h.length; i++) if (Math.abs(h[i]) > Math.abs(h[pk])) pk = i;
	const start0 = Math.max(0, pk - Math.floor(0.002 * fs));
	let ref = -Infinity;
	for (let s = 0; s < nSteps; s++) {
		const st = start0 + s * step;
		const seg = new Float64Array(win);
		for (let i = 0; i < win; i++) {
			const j = st + i;
			// ventana: flanco de subida muy corto + Hann de bajada (estilo CSD)
			const w = i < win * 0.05 ? i / (win * 0.05) : 0.5 + 0.5 * Math.cos((Math.PI * (i - win * 0.05)) / (win * 0.95));
			seg[i] = j < h.length ? h[j] * w : 0;
		}
		const S = rfft(seg, nfft);
		const row = freqs.map((f) => {
			const k = Math.round((f * nfft) / fs);
			const p = S.re[k] * S.re[k] + S.im[k] * S.im[k];
			return 10 * Math.log10(Math.max(p, 1e-20));
		});
		if (s === 0) ref = Math.max(...row);
		rows.push(row.map((v) => v - ref));
		times.push(s * opts.stepMs);
	}
	return { freqs, times, rows };
}

/** DFT de un solo bin (Goertzel) de una serie real; devuelve [re, im]. */
export function goertzel(x: Float32Array, off: number, n: number, f: number, fs: number): Cx {
	const w = (2 * Math.PI * f) / fs;
	const cw = Math.cos(w);
	const sw = Math.sin(w);
	const coeff = 2 * cw;
	let s1 = 0, s2 = 0;
	for (let i = 0; i < n; i++) {
		const s0 = x[off + i] + coeff * s1 - s2;
		s2 = s1;
		s1 = s0;
	}
	return [s1 - s2 * cw, s2 * sw];
}
