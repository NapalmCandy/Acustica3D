import { it, expect } from 'vitest';
import { findPaths, HF_OCTAVES } from '../lib/hf/imageSource';
import { addBox } from '../lib/sim/testgeo';
const C = (x: number) => { let s = 0; const n = 4000; for (let i = 0; i < n; i++) { const t = (i + 0.5) * x / n; s += Math.cos(Math.PI * t * t / 2); } return s * x / n; };
const S = (x: number) => { let s = 0; const n = 4000; for (let i = 0; i < n; i++) { const t = (i + 0.5) * x / n; s += Math.sin(Math.PI * t * t / 2); } return s * x / n; };
const F = (v: number) => Math.hypot(0.5 - C(v), 0.5 - S(v)) / Math.SQRT2;
it('borde', () => {
	for (const h of [-0.3, -0.15, -0.05, 0, 0.05, 0.1, 0.2, 0.4]) {
		const r = { positions: [] as number[], materials: [] as string[] };
		addBox(r, [-5, -5, -2.01], [5, 1 + h, -1.99], 'pantalla');
		const p = findPaths(Float32Array.from(r.positions), Int32Array.from(r.materials.map(() => 0)), [{ id: 'k', pos: [0, 1, 0] }], [0, 1, -4], { maxOrder: 0 });
		const d = p.find((x) => x.order === 0);
		const line = HF_OCTAVES.slice(2).map((f, i) => {
			const lam = 343 / f, v = h * Math.sqrt((2 * 4) / (lam * 4));
			return `${f}:${d ? (20 * Math.log10(d.fres![i + 2])).toFixed(1) : '—'}/${(20 * Math.log10(F(v))).toFixed(1)}`;
		});
		console.log('h', h, line.join('  '));
	}
	// reflector cuadrado de lado a frente a la primera zona: refleja más que uno infinito cuando a ≈ zona
	for (const a of [0.2, 0.5, 1, 2, 8]) {
		const r = { positions: [] as number[], materials: [] as string[] };
		addBox(r, [-a / 2, -0.02, -a / 2 - 2], [a / 2, 0, a / 2 - 2], 'tabla');
		const p = findPaths(Float32Array.from(r.positions), Int32Array.from(r.materials.map(() => 0)), [{ id: 'k', pos: [0, 1, -1] }], [0, 1, -3], { maxOrder: 1 });
		const x = p.find((q) => q.order === 1);
		console.log('placa', a, x ? x.fres!.slice(2).map((v) => (20 * Math.log10(v)).toFixed(1)).join(' ') : 'nada');
	}
	expect(1).toBe(1);
});
