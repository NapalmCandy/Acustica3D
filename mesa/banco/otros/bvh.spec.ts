import { it, expect } from 'vitest';
import { loadScene, alphaTable, assemble } from './hfeval';
import { Bvh } from '../lib/hf/fresnel';
it('bvh = fuerza bruta', async () => {
	const s = await loadScene();
	const geo = assemble(s, () => true, []);
	const T = Float32Array.from(geo.pos), n = geo.mats.length;
	const tp = new Int32Array(n).fill(0);
	const bvh = new Bvh(T, n, () => true, tp);
	const brute = (a: number[], b: number[]) => {
		const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
		for (let t = 0; t < n; t++) {
			const p = t * 9;
			const e1 = [T[p + 3] - T[p], T[p + 4] - T[p + 1], T[p + 5] - T[p + 2]], e2 = [T[p + 6] - T[p], T[p + 7] - T[p + 1], T[p + 8] - T[p + 2]];
			const pv = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
			const det = e1[0] * pv[0] + e1[1] * pv[1] + e1[2] * pv[2];
			if (Math.abs(det) < 1e-12) continue;
			const sv = [a[0] - T[p], a[1] - T[p + 1], a[2] - T[p + 2]];
			const u = (sv[0] * pv[0] + sv[1] * pv[1] + sv[2] * pv[2]) / det; if (u < 0 || u > 1) continue;
			const q = [sv[1] * e1[2] - sv[2] * e1[1], sv[2] * e1[0] - sv[0] * e1[2], sv[0] * e1[1] - sv[1] * e1[0]];
			const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / det; if (v < 0 || u + v > 1) continue;
			const tt = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
			if (tt > 1e-4 && tt < 1 - 1e-4) return true;
		}
		return false;
	};
	let bad = 0, hit = 0;
	const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
	for (let i = 0; i < 3000; i++) {
		const a = [rnd(1, 3), rnd(0.5, 1.5), rnd(-6, -4)], b = [rnd(1, 3), rnd(0.5, 1.5), rnd(-6, -4)];
		if (i % 3 === 0) b[1] = a[1]; // horizontales
		const x = bvh.blocked(a as any, b as any), y = brute(a, b);
		if (y) hit++;
		if (x !== y) bad++;
	}
	const t0 = performance.now();
	for (let i = 0; i < 20000; i++) bvh.blocked([rnd(0.5, 3.5), rnd(0.3, 2), rnd(-6, -1)], [rnd(0.5, 3.5), rnd(0.3, 2), rnd(-6, -1)]);
	console.log('distintos', bad, 'de 3000; tapados', hit, ' µs/rayo', ((performance.now() - t0) / 20).toFixed(2));
	expect(bad).toBe(0);
}, 600000);
