// Escala de puntuación compartida: rojo (peor) → blanco → verde (mejor), relativa a lo que se compara.
export const SCORE_RAMP = ['#b2182b', '#d6604d', '#f4a582', '#fddbc7', '#f7f7f7', '#d9f0d3', '#a6dba0', '#5aae61', '#1b7837'];
export const YOU_COLOR = '#7c4dcc';
export const BEST_COLOR = '#fab219';

function lerpHex(a: string, b: string, t: number) {
	const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
	const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
	return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',')})`;
}

export function scoreColor(v: number, lo: number, hi: number) {
	if (!Number.isFinite(v)) return 'rgba(137,135,129,0.35)';
	const u = hi > lo ? (v - lo) / (hi - lo) : 0.5;
	const t = Math.max(0, Math.min(1, u)) * (SCORE_RAMP.length - 1);
	const i = Math.min(SCORE_RAMP.length - 2, Math.floor(t));
	return lerpHex(SCORE_RAMP[i], SCORE_RAMP[i + 1], t - i);
}
