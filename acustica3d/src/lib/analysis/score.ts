// Puntuación de cada posible posición de escucha en el plano de los oídos.
// Entradas: espectros de cada fuente en cada celda del plano (completo y "tardío", t > 120 ms),
// respuestas de altavoz/cruce por canal y pesos de cada criterio. Todo se recalcula al instante.
import type { Cx } from '../acoustics/speakers';
import type { V3 } from '../sim/voxel';

export interface PlaneSpectra {
	freqs: number[];
	ids: string[]; // fuentes ('khL', 'khR', 'sub')
	/** por fuente: re/im de nCells × nF (normalizados: 0 dB = campo libre a 1 m) */
	re: Float32Array[];
	im: Float32Array[];
	lateRe: Float32Array[];
	lateIm: Float32Array[];
	ix: Int32Array;
	iz: Int32Array;
	/** distancia (m) de cada celda al obstáculo más cercano en el plano */
	wallDist: Float32Array;
	/** aire (1) / obstáculo (0) del plano, nx × nz; sin él se toma como pared el borde de la rejilla */
	mask?: Uint8Array;
	nx: number;
	nz: number;
	dx: number;
	origin: V3;
	y: number;
}

export type Criterion = 'plano' | 'huecos' | 'picos' | 'retumbe' | 'robustez' | 'simetria' | 'paredes' | 'geometria';

export const CRITERIA: { id: Criterion; label: string; help: string }[] = [
	{ id: 'plano', label: 'Grave plano', help: 'Desviación típica de la respuesta dentro del rango de frecuencias elegido.' },
	{ id: 'huecos', label: 'Sin huecos', help: 'Cancelaciones de más de 6 dB: el DSP no las arregla.' },
	{ id: 'picos', label: 'Sin picos', help: 'Acumulaciones de más de 6 dB: el DSP sí puede recortarlas.' },
	{ id: 'retumbe', label: 'Poco retumbe', help: 'Energía que llega después de 120 ms (modos que suenan largo).' },
	{ id: 'robustez', label: 'Robustez', help: 'Cuánto cambia el grave al mover la cabeza ±20 cm.' },
	{ id: 'simetria', label: 'Simetría estéreo', help: 'Paredes laterales a la misma distancia a tu izquierda y a tu derecha (reflexiones simétricas: imagen centrada) y mismo nivel de grave de cada canal.' },
	{ id: 'paredes', label: 'Lejos de paredes', help: 'Pared de detrás a ≥ 1,2 m y laterales a ≥ 1 m. Más cerca, la reflexión llega casi a la vez que el sonido directo (≈ 2 ms a 30 cm): filtro peine e imagen borrosa.' },
	{ id: 'geometria', label: 'Geometría', help: 'Triángulo con los KH, distancia razonable y delante de ellos.' }
];

/** Criterio que solo usa la colocación automática en modo ULTRA (no el mapa de «Mejor posición»). */
export const HF_CRITERION = {
	id: 'reflexiones' as const,
	label: 'Medios y agudos',
	help: 'Solo en ULTRA: energía de las reflexiones que llegan a tu oído en los primeros 20 ms (1–8 kHz, respecto al directo), con la mesa, la pantalla y el tratamiento colocado. −18 dB o menos = 100; −3 dB = 0.'
};

// Pesos: la imagen estéreo (simetría y distancia a paredes) cuenta tanto como los huecos de grave,
// que tampoco se corrigen con DSP; los picos pesan poco porque el DSP sí los recorta.
export const DEFAULT_WEIGHTS: Record<Criterion, number> = {
	plano: 1, huecos: 1.5, picos: 0.5, retumbe: 1, robustez: 0.8, simetria: 1.5, paredes: 1.5, geometria: 1
};

/** Distancia (m) desde p en la dirección (ux, uz) hasta el primer obstáculo del plano (máx. 6 m). */
export function rayToWall(ps: Pick<PlaneSpectra, 'mask' | 'nx' | 'nz' | 'dx' | 'origin'>, x: number, z: number, ux: number, uz: number): number {
	const step = ps.dx / 2;
	for (let t = step; t < 6; t += step) {
		const gx = Math.floor((x + ux * t - ps.origin[0]) / ps.dx), gz = Math.floor((z + uz * t - ps.origin[2]) / ps.dx);
		if (gx < 0 || gz < 0 || gx >= ps.nx || gz >= ps.nz) return t;
		if (ps.mask && !ps.mask[gz * ps.nx + gx]) return t;
	}
	return 6;
}

/** Criterios que dependen solo de dónde está la cabeza respecto a las paredes, mirando hacia `target`.
 *  Devuelve la "maldad" 0–1 de simetría lateral y de cercanía a paredes. */
export function wallCriteria(ps: Pick<PlaneSpectra, 'mask' | 'nx' | 'nz' | 'dx' | 'origin'>, x: number, z: number, tx: number, tz: number) {
	let ux = tx - x, uz = tz - z;
	const n = Math.hypot(ux, uz) || 1;
	ux /= n;
	uz /= n;
	const rx = -uz, rz = ux; // derecha del oyente
	const dRight = rayToWall(ps, x, z, rx, rz), dLeft = rayToWall(ps, x, z, -rx, -rz), dBack = rayToWall(ps, x, z, -ux, -uz);
	// asimetría lateral: 0,8 m de diferencia = peor (cuenta menos si ambas paredes están lejos)
	const sideAsym = clamp01(Math.abs(dLeft - dRight) / Math.max(0.8, 0.4 * Math.min(dLeft, dRight)));
	const near = Math.max(clamp01((1.2 - dBack) / 0.7), clamp01((1.0 - Math.min(dLeft, dRight)) / 0.6));
	return { sideAsym, near, dLeft, dRight, dBack };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export interface ScoreMap {
	/** 0–100 (100 = mejor), NaN si la celda no es candidata (pegada a una pared, demasiado cerca
	 *  de los altavoces, fuera del ángulo útil o detrás de ellos) */
	total: Float32Array;
	/** "maldad" 0–1 por criterio y celda */
	parts: Record<Criterion, Float32Array>;
	best: number; // índice de celda
	bestPos: V3;
}

type Gain = (id: string, f: number, ch: 'L' | 'R' | 'mono') => Cx;


export function computeScores(
	ps: PlaneSpectra,
	gain: Gain,
	weights: Record<Criterion, number>,
	geom: { khL: V3; khR: V3; listener: V3 },
	opts: { minWallDist?: number; robustRadius?: number; band?: [number, number]; minListenDist?: number; maxListenDist?: number; maxAngle?: number; minAngle?: number; maxOffCenter?: number } = {}
): ScoreMap {
	const minWallDist = opts.minWallDist ?? 0.5, robustRadius = opts.robustRadius ?? 0.2;
	// posiciones de escucha posibles: delante de los KH, entre 0,7 y 2,5 m (monitores de campo cercano),
	// viéndolos con 30°–90° de apertura y más o menos centrado (|dL − dR| ≤ 0,35 m). Pegado a ellos,
	// entre ambos o al lado de uno el sonido directo domina y la curva sale "plana", pero no es un sitio de escucha.
	const minListenDist = opts.minListenDist ?? 0.7, maxListenDist = opts.maxListenDist ?? 2.5;
	const maxAngle = opts.maxAngle ?? 90, minAngle = opts.minAngle ?? 30, maxOffCenter = opts.maxOffCenter ?? 0.35;
	const valid = new Uint8Array(ps.ix.length);
	const nC = ps.ix.length;
	// solo cuentan las frecuencias dentro del rango elegido (p. ej. 40–200 Hz si el sub no baja más)
	const [bLo, bHi] = opts.band ?? [0, Infinity];
	let kb = ps.freqs.findIndex((f) => f >= bLo * 0.999);
	if (kb < 0) kb = ps.freqs.length - 1;
	let ke = ps.freqs.length;
	while (ke > kb + 1 && ps.freqs[ke - 1] > bHi * 1.001) ke--;
	const nF = ke - kb;
	const S = ps.ids.length;
	// ganancias por fuente, frecuencia y canal
	const G = (ch: 'L' | 'R' | 'mono') => ps.ids.map((id) => ps.freqs.slice(kb, ke).map((f) => gain(id, f, ch)));
	const NF = ps.freqs.length;
	const gM = G('mono'), gL = G('L'), gR = G('R');
	const dbM = new Float32Array(nC * nF);
	const parts: Record<Criterion, Float32Array> = {
		plano: new Float32Array(nC), huecos: new Float32Array(nC), picos: new Float32Array(nC), retumbe: new Float32Array(nC),
		robustez: new Float32Array(nC), simetria: new Float32Array(nC), paredes: new Float32Array(nC), geometria: new Float32Array(nC)
	};
	for (let c = 0; c < nC; c++) {
		let mean = 0;
		let eFull = 0, eLate = 0, sym = 0;
		for (let k = 0; k < nF; k++) {
			let mr = 0, mi = 0, lr = 0, li = 0, rr = 0, ri = 0, tr = 0, ti = 0;
			const o = c * NF + kb + k;
			for (let s = 0; s < S; s++) {
				const hr = ps.re[s][o], hi = ps.im[s][o];
				const a = gM[s][k], bl = gL[s][k], br = gR[s][k];
				mr += hr * a[0] - hi * a[1]; mi += hr * a[1] + hi * a[0];
				lr += hr * bl[0] - hi * bl[1]; li += hr * bl[1] + hi * bl[0];
				rr += hr * br[0] - hi * br[1]; ri += hr * br[1] + hi * br[0];
				const xr = ps.lateRe[s][o], xi = ps.lateIm[s][o];
				tr += xr * a[0] - xi * a[1]; ti += xr * a[1] + xi * a[0];
			}
			const pm = mr * mr + mi * mi;
			const d = 10 * Math.log10(pm + 1e-20);
			dbM[c * nF + k] = d;
			mean += d;
			eFull += pm;
			eLate += tr * tr + ti * ti;
			sym += Math.abs(10 * Math.log10((lr * lr + li * li + 1e-20) / (rr * rr + ri * ri + 1e-20)));
		}
		mean /= nF;
		let sq = 0, holes = 0, peaks = 0;
		for (let k = 0; k < nF; k++) {
			const dev = dbM[c * nF + k] - mean;
			sq += dev * dev;
			holes += Math.max(0, -dev - 6);
			peaks += Math.max(0, dev - 6);
		}
		parts.plano[c] = clamp01(Math.sqrt(sq / nF) / 6); // 6 dB de desviación típica → peor
		parts.huecos[c] = clamp01(holes / nF / 4);
		parts.picos[c] = clamp01(peaks / nF / 4);
		const lateDb = 10 * Math.log10((eLate + 1e-20) / (eFull + 1e-20)); // −30 dB bueno, −10 dB malo
		parts.retumbe[c] = clamp01((lateDb + 30) / 20);
		// geometría
		const x = ps.origin[0] + (ps.ix[c] + 0.5) * ps.dx;
		const z = ps.origin[2] + (ps.iz[c] + 0.5) * ps.dx;
		// imagen estéreo: paredes laterales simétricas (65 %) y mismo grave por canal (35 %); cercanía a paredes
		const wc = wallCriteria(ps, x, z, (geom.khL[0] + geom.khR[0]) / 2, (geom.khL[2] + geom.khR[2]) / 2);
		parts.simetria[c] = 0.65 * wc.sideAsym + 0.35 * clamp01(sym / nF / 3);
		parts.paredes[c] = wc.near;
		const dL = Math.hypot(x - geom.khL[0], z - geom.khL[2]);
		const dR = Math.hypot(x - geom.khR[0], z - geom.khR[2]);
		const base = Math.hypot(geom.khR[0] - geom.khL[0], geom.khR[2] - geom.khL[2]);
		const angle = Math.acos(Math.max(-1, Math.min(1, (dL * dL + dR * dR - base * base) / (2 * dL * dR)))) * (180 / Math.PI);
		const dMean = (dL + dR) / 2;
		// lado de los altavoces en el que está el oyente actual = "delante"
		const side = (px: number, pz: number) =>
			(geom.khR[0] - geom.khL[0]) * (pz - geom.khL[2]) - (geom.khR[2] - geom.khL[2]) * (px - geom.khL[0]);
		const front = Math.sign(side(geom.listener[0], geom.listener[2])) === Math.sign(side(x, z));
		let gbad = 0.5 * clamp01(Math.abs(dL - dR) / 0.3) + 0.3 * clamp01(Math.abs(angle - 60) / 30);
		gbad += 0.2 * clamp01(dMean < 0.8 ? (0.8 - dMean) / 0.4 : dMean > 2.0 ? (dMean - 2.0) / 1.0 : 0);
		parts.geometria[c] = front ? clamp01(gbad) : 1;
		valid[c] = front && dMean >= minListenDist && dMean <= maxListenDist && angle <= maxAngle && angle >= minAngle &&
			Math.abs(dL - dR) <= maxOffCenter && ps.wallDist[c] >= minWallDist ? 1 : 0;
	}
	// robustez: diferencia media con las celdas vecinas dentro del radio
	const r = Math.max(1, Math.round(robustRadius / ps.dx));
	const cellAt = new Int32Array(ps.nx * ps.nz).fill(-1);
	for (let c = 0; c < nC; c++) cellAt[ps.iz[c] * ps.nx + ps.ix[c]] = c;
	for (let c = 0; c < nC; c++) {
		let acc = 0, n = 0;
		for (let dz = -r; dz <= r; dz++)
			for (let dxx = -r; dxx <= r; dxx++) {
				if (!dz && !dxx) continue;
				if (dz * dz + dxx * dxx > r * r) continue;
				const x = ps.ix[c] + dxx, z = ps.iz[c] + dz;
				if (x < 0 || z < 0 || x >= ps.nx || z >= ps.nz) continue;
				const o = cellAt[z * ps.nx + x];
				if (o < 0) continue;
				let d = 0;
				for (let k = 0; k < nF; k++) d += Math.abs(dbM[c * nF + k] - dbM[o * nF + k]);
				acc += d / nF;
				n++;
			}
		parts.robustez[c] = clamp01((n ? acc / n : 0) / 4);
	}
	// total
	const wsum = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
	const total = new Float32Array(nC);
	let best = -1;
	for (let c = 0; c < nC; c++) {
		if (!valid[c]) {
			total[c] = NaN;
			continue;
		}
		let bad = 0;
		for (const k of Object.keys(weights) as Criterion[]) if (parts[k]) bad += weights[k] * parts[k][c];
		total[c] = 100 * (1 - bad / wsum);
		if (best < 0 || total[c] > total[best]) best = c;
	}
	const bestPos: V3 = best >= 0
		? [ps.origin[0] + (ps.ix[best] + 0.5) * ps.dx, geom.listener[1], ps.origin[2] + (ps.iz[best] + 0.5) * ps.dx]
		: geom.listener;
	return { total, parts, best, bestPos };
}

/** Respuesta (dB, 0 dB = campo libre a 1 m) de una celda del plano con el sistema completo (L+R+sub, mono). */
export function cellResponse(ps: PlaneSpectra, gain: Gain, c: number, ch: 'L' | 'R' | 'mono' = 'mono'): Float32Array {
	const nF = ps.freqs.length;
	const out = new Float32Array(nF);
	for (let k = 0; k < nF; k++) {
		let r = 0, i = 0;
		for (let s = 0; s < ps.ids.length; s++) {
			const g = gain(ps.ids[s], ps.freqs[k], ch);
			const hr = ps.re[s][c * nF + k], hi = ps.im[s][c * nF + k];
			r += hr * g[0] - hi * g[1];
			i += hr * g[1] + hi * g[0];
		}
		out[k] = 10 * Math.log10(r * r + i * i + 1e-20);
	}
	return out;
}

/** Celda del plano más cercana a una posición (−1 si el plano está vacío). */
export function nearestCell(ps: PlaneSpectra, p: V3): number {
	const ix = (p[0] - ps.origin[0]) / ps.dx - 0.5, iz = (p[2] - ps.origin[2]) / ps.dx - 0.5;
	let best = -1, bd = Infinity;
	for (let c = 0; c < ps.ix.length; c++) {
		const d = (ps.ix[c] - ix) ** 2 + (ps.iz[c] - iz) ** 2;
		if (d < bd) { bd = d; best = c; }
	}
	return best;
}
