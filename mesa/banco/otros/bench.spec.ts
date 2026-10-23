import { it, expect } from 'vitest';
import { acousticParts, type PointTF } from '../lib/sim/optimize';
it('bench', () => {
	const nF = 49;
	const tf = (): PointTF => ({ re: Float32Array.from({ length: nF }, Math.random), im: Float32Array.from({ length: nF }, Math.random), lateRe: Float32Array.from({ length: nF }, Math.random), lateIm: Float32Array.from({ length: nF }, Math.random) });
	const L = tf(), R = tf(), S = tf();
	const g = Array.from({ length: nF }, () => [Math.random(), Math.random()] as [number, number]);
	const t0 = performance.now();
	let x = 0;
	for (let i = 0; i < 200000; i++) x += acousticParts(L, R, S, g, g, 1).plano;
	console.log('µs por llamada', ((performance.now() - t0) / 200).toFixed(2), x > 0);
	expect(1).toBe(1);
});
