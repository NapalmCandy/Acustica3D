// Modelos de altavoz en baja frecuencia (respuesta compleja normalizada a 0 dB en la banda de paso).
// KH 120 A: mismo modelo calibrado de la Fase 2 (Thiele-Small + reflex + electrónica estimada).
// Sub8: ESTIMADO (paso alto de 4.º orden a 28 Hz y cruce LR4 ajustable); se afinará midiendo.

export type Cx = [number, number];

export const cmul = (a: Cx, b: Cx): Cx => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
export const cdiv = (a: Cx, b: Cx): Cx => {
	const d = b[0] * b[0] + b[1] * b[1];
	return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
};
export const cadd = (a: Cx, b: Cx): Cx => [a[0] + b[0], a[1] + b[1]];
export const cabs = (a: Cx) => Math.hypot(a[0], a[1]);
export const cexpj = (ph: number): Cx => [Math.cos(ph), Math.sin(ph)];

const KH = {
	Re: 5.6, Bl: 6.2, Mms: 11.5e-3, Sd: 88e-4, fs: 38.0, Qms: 3.5,
	Vb: 6.5e-3, Fb: 45.0, QL: 10, Qp: 60,
	fInfra: 30, eqF: 55, eqG: 2.2, eqQ: 1.8, fXo: 2000, fHf: 21000
};
const RHO = 1.204;
const C0 = 343;

/** Resuelve A x = b (4×4 complejo) por eliminación gaussiana con pivote. */
function solve4(A: Cx[][], b: Cx[]): Cx[] {
	const n = 4;
	const M = A.map((r, i) => [...r, b[i]]);
	for (let k = 0; k < n; k++) {
		let piv = k;
		for (let i = k + 1; i < n; i++) if (cabs(M[i][k]) > cabs(M[piv][k])) piv = i;
		[M[k], M[piv]] = [M[piv], M[k]];
		for (let i = k + 1; i < n; i++) {
			const f = cdiv(M[i][k], M[k][k]);
			for (let j = k; j <= n; j++) M[i][j] = cadd(M[i][j], cmul([-f[0], -f[1]], M[k][j]));
		}
	}
	const x: Cx[] = [[0, 0], [0, 0], [0, 0], [0, 0]];
	for (let i = n - 1; i >= 0; i--) {
		let s = M[i][n];
		for (let j = i + 1; j < n; j++) s = cadd(s, cmul([-M[i][j][0], -M[i][j][1]], x[j]));
		x[i] = cdiv(s, M[i][i]);
	}
	return x;
}

/** Forma del paso alto acústico del KH 120 A (reflex + mecánica), 1 en la banda de paso. */
function khBassShape(f: number): Cx {
	const w = 2 * Math.PI * Math.max(f, 1e-3);
	const s: Cx = [0, w];
	const ws = 2 * Math.PI * KH.fs;
	const Kms = ws * ws * KH.Mms;
	const Rms = (ws * KH.Mms) / KH.Qms;
	const Cab = KH.Vb / (RHO * C0 * C0);
	const wb = 2 * Math.PI * KH.Fb;
	const Map = 1 / (wb * wb * Cab);
	const Ral = KH.QL / (wb * Cab);
	const Rap = (wb * Map) / KH.Qp;
	const inv = (z: Cx) => cdiv([1, 0], z);
	// incógnitas: I, v, Pb, Up (sin Le: solo interesa la forma)
	const A: Cx[][] = [
		[[KH.Re, 0], [KH.Bl, 0], [0, 0], [0, 0]],
		[[-KH.Bl, 0], cadd(cadd([0, w * KH.Mms], [Rms, 0]), cmul([Kms, 0], inv(s))), [-KH.Sd, 0], [0, 0]],
		[[0, 0], [KH.Sd, 0], [1 / Ral, w * Cab], [1, 0]],
		[[0, 0], [0, 0], [-1, 0], [Rap, w * Map]]
	];
	const [, v, Pb, Up] = solve4(A, [[1, 0], [0, 0], [0, 0], [0, 0]]);
	const U = cadd(cadd(cmul([KH.Sd, 0], v), Up), cmul([1 / Ral, 0], Pb));
	const p = cmul([0, (w * RHO) / (2 * Math.PI)], U);
	const ref = (RHO * KH.Bl * KH.Sd) / (2 * Math.PI * KH.Mms * KH.Re);
	return [p[0] / ref, p[1] / ref];
}

/** Paso alto/bajo analógicos genéricos */
export function hp1(f: number, fc: number): Cx {
	const s: Cx = [0, f / fc];
	return cdiv(s, cadd([1, 0], s));
}
function sos(f: number, fc: number, Q: number, kind: 'lp' | 'hp'): Cx {
	const s: Cx = [0, f / fc];
	const s2 = cmul(s, s);
	const den = cadd(cadd(s2, [s[0] / Q, s[1] / Q]), [1, 0]);
	return cdiv(kind === 'lp' ? [1, 0] : s2, den);
}
export function butter(f: number, fc: number, order: 2 | 4, kind: 'lp' | 'hp'): Cx {
	if (order === 2) return sos(f, fc, Math.SQRT1_2, kind);
	return cmul(sos(f, fc, 0.5412, kind), sos(f, fc, 1.3066, kind));
}
export function lr4(f: number, fc: number, kind: 'lp' | 'hp'): Cx {
	const b = sos(f, fc, Math.SQRT1_2, kind);
	return cmul(b, b);
}
function peq(f: number, f0: number, g: number, Q: number): Cx {
	const A = Math.pow(10, g / 40);
	const s: Cx = [0, f / f0];
	const s2 = cmul(s, s);
	const num = cadd(cadd(s2, [s[0] * (A / Q), s[1] * (A / Q)]), [1, 0]);
	const den = cadd(cadd(s2, [s[0] / (A * Q), s[1] / (A * Q)]), [1, 0]);
	return cdiv(num, den);
}

/** Estante analógico de 2.º orden: ganancia g dB por debajo (lo) o por encima (hi) de f0 (en f0, g/2). */
function shelf(f: number, f0: number, g: number, kind: 'lo' | 'hi', Q = Math.SQRT1_2): Cx {
	if (!g) return [1, 0];
	const A = Math.pow(10, g / 40), q = Math.sqrt(A) / Q;
	const s: Cx = [0, f / f0];
	const s2 = cmul(s, s);
	const num = kind === 'lo'
		? cadd(cadd([s2[0] * A, s2[1] * A], [s[0] * q * A, s[1] * q * A]), [A * A, 0])
		: cadd(cadd([s2[0] * A * A, s2[1] * A * A], [s[0] * q * A, s[1] * q * A]), [A, 0]);
	const den = kind === 'lo'
		? cadd(cadd([s2[0] * A, s2[1] * A], [s[0] * q, s[1] * q]), [1, 0])
		: cadd(cadd(s2, [s[0] * q, s[1] * q]), [A, 0]);
	return cdiv(num, den);
}

/** Interruptores del panel trasero del KH 120 A. Niveles del manual de Neumann; frecuencias y Q
 *  ajustados a la gráfica «Acoustical Controls» del manual (pág. 25), extrayendo sus trazos vectoriales
 *  y restando la curva de referencia: error típico < 0,2 dB entre 40 Hz y 2 kHz.
 *  Con `enabled = false` se ignoran (y desaparecen de la barra lateral y del optimizador). */
export const KH_EQ = {
	enabled: true,
	bassHz: 182.5, // Bass: estante bajo (carga de una pared cercana)
	bassQ: 0.62,
	lowMidHz: 260, // Low-Mid: campana ancha (carga de la mesa o la consola)
	lowMidQ: 0.36,
	trebleHz: 5430, // Treble: estante alto (fuera de la simulación de graves)
	trebleQ: 0.84
};

export const KH_SWITCHES = {
	bassDb: [0, -2.5, -5, -7.5],
	lowMidDb: [0, -1.5, -3, -4.5],
	trebleDb: [1, 0, -1, -2]
} as const;

export interface KhOptions {
	satHpf85: boolean; // filtro de 85 Hz de las salidas a satélites del Sub8
	bassDb?: number;
	lowMidDb?: number;
	trebleDb?: number;
}

/** Respuesta del KH 120 A (en eje, 1 m, campo libre equivalente), 0 dB en banda media. */
export function khResponse(f: number, o: KhOptions): Cx {
	let h = cmul(khBassShape(f), cmul(hp1(f, KH.fInfra), peq(f, KH.eqF, KH.eqG, KH.eqQ)));
	// cruce LR4 a 2 kHz (pasatodo en la suma)
	h = cmul(h, cadd(lr4(f, KH.fXo, 'lp'), lr4(f, KH.fXo, 'hp')));
	if (o.satHpf85) h = cmul(h, butter(f, 85, 2, 'hp')); // [estimado] 12 dB/oct
	if (KH_EQ.enabled) {
		if (o.bassDb) h = cmul(h, shelf(f, KH_EQ.bassHz, o.bassDb, 'lo', KH_EQ.bassQ));
		if (o.lowMidDb) h = cmul(h, peq(f, KH_EQ.lowMidHz, o.lowMidDb, KH_EQ.lowMidQ));
		if (o.trebleDb) h = cmul(h, shelf(f, KH_EQ.trebleHz, o.trebleDb, 'hi', KH_EQ.trebleQ));
	}
	return h;
}

export interface SubOptions {
	enabled: boolean;
	xoverHz: number; // 50–150
	polarityInvert: boolean;
	gainDb: number;
	extraDelayMs: number;
}

/** Respuesta del ADAM Sub8 [ESTIMADA]: 4.º orden a 28 Hz + cruce LR4. */
export function subResponse(f: number, o: SubOptions): Cx {
	let h = cmul(butter(f, 28, 4, 'hp'), lr4(f, o.xoverHz, 'lp'));
	const g = Math.pow(10, o.gainDb / 20) * (o.polarityInvert ? -1 : 1);
	h = [h[0] * g, h[1] * g];
	if (o.extraDelayMs) h = cmul(h, cexpj(-2 * Math.PI * f * o.extraDelayMs * 1e-3));
	return h;
}
