// Colocación automática (KH izquierdo y derecho, sub y oyente).
//
// Idea clave: reciprocidad. La respuesta de un altavoz en A medida en B es la misma que la de una
// fuente en B medida en A. Así, con UNA simulación con la fuente en la cabeza del oyente se obtiene
// a la vez la respuesta de todas las posiciones posibles de los KH y del sub, y se pueden puntuar
// miles de combinaciones sin volver a simular. Hace falta una simulación por cada posición del oyente.
import type { Cx } from '../acoustics/speakers';
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

/** KH en triángulo equilátero delante del oyente (a `dist` m de la cabeza, a la altura `khY`). */
export function khPair(listener: V3, facingDeg: number, dist: number, khY: number): { khL: V3; khR: V3 } {
	const [ux, uz] = facingDir(facingDeg);
	const rx = -uz, rz = ux; // derecha del oyente
	const f = dist * Math.cos(Math.PI / 6), s = dist * Math.sin(Math.PI / 6);
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
export function totalScore(parts: Partial<Record<Criterion, number>>, weights: Record<Criterion, number>): number {
	let bad = 0, wsum = 0;
	for (const k of Object.keys(parts) as Criterion[]) {
		const w = weights[k] ?? 0;
		bad += w * (parts[k] ?? 0);
		wsum += w;
	}
	return 100 * (1 - bad / (wsum || 1));
}

export interface OptConfig {
	score: number;
	listener: V3;
	facing: number;
	dist: number;
	khL: V3;
	khR: V3;
	sub: V3 | null;
	subInvert: boolean;
	parts: Partial<Record<Criterion, number>>;
}
