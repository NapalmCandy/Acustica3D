import { describe, it, expect } from 'vitest';
import { findPaths, HF_OCTAVES } from './imageSource';
import { addBox, type NamedTris } from '../sim/testgeo';

// difracción en un borde recto (Fresnel–Kirchhoff): |F(v)|
const fresnelCS = (x: number) => {
	let c = 0, s = 0;
	const n = 4000;
	for (let i = 0; i < n; i++) {
		const t = ((i + 0.5) * x) / n;
		(c += Math.cos((Math.PI * t * t) / 2)), (s += Math.sin((Math.PI * t * t) / 2));
	}
	return [(c * x) / n, (s * x) / n];
};
const knife = (v: number) => {
	const [c, s] = fresnelCS(v);
	return Math.hypot(0.5 - c, 0.5 - s) / Math.SQRT2;
};
const run = (r: NamedTris, S: [number, number, number], E: [number, number, number], maxOrder: number) =>
	findPaths(Float32Array.from(r.positions), Int32Array.from(r.materials.map(() => 0)), [{ id: 'k', pos: S }], E, { maxOrder });
const db = (x: number) => 20 * Math.log10(x);

describe('difracción por zonas de Fresnel', () => {
	it('un borde recto da la difracción de Fresnel–Kirchhoff (±2,5 dB de 500 Hz a 4 kHz)', () => {
		for (const h of [-0.15, -0.05, 0.05, 0.1, 0.2]) {
			// pared fina con el borde de arriba a h del camino (h > 0: el camino queda a la sombra)
			const r: NamedTris = { positions: [], materials: [] };
			addBox(r, [-5, -5, -2.01], [5, 1 + h, -1.99], 'pantalla');
			const d = run(r, [0, 1, 0], [0, 1, -4], 0).find((p) => p.order === 0)!;
			expect(d.soft).toBe(h > 0);
			for (const f of [500, 1000, 2000, 4000]) {
				const v = h * Math.sqrt(2 / (343 / f)); // d1 = d2 = 2 m
				expect(Math.abs(db(d.fres![HF_OCTAVES.indexOf(f)]) - db(knife(v)))).toBeLessThan(2.5);
			}
		}
	});

	it('un reflector pequeño apenas refleja en medios; uno grande, todo', () => {
		const plate = (a: number) => {
			const r: NamedTris = { positions: [], materials: [] };
			addBox(r, [-a / 2, -0.02, -a / 2 - 2], [a / 2, 0, a / 2 - 2], 'tabla');
			return run(r, [0, 1, -1], [0, 1, -3], 1).find((p) => p.order === 1)!.fres!;
		};
		const small = plate(0.2), big = plate(8);
		const i500 = HF_OCTAVES.indexOf(500), i16k = HF_OCTAVES.indexOf(16000);
		expect(db(small[i500])).toBeLessThan(-20); // 20 × 20 cm a 500 Hz
		expect(db(small[i16k])).toBeGreaterThan(-3); // y casi entero a 16 kHz
		for (const v of big.slice(2)) expect(Math.abs(db(v))).toBeLessThan(0.5);
	});

	// óptica física (integral de Kirchhoff sobre la cara de arriba, rígida) respecto al plano infinito
	const po = (x0: number, x1: number, z0: number, z1: number, S: number[], E: number[], f: number) => {
		const k = (2 * Math.PI * f) / 343, h = Math.min(0.004, 343 / f / 14);
		const L = Math.hypot(E[0] - S[0], E[1] + S[1], E[2] - S[2]);
		let re = 0, im = 0;
		for (let x = x0 + h / 2; x < x1; x += h)
			for (let z = z0 + h / 2; z < z1; z += h) {
				const r1 = Math.hypot(x - S[0], S[1], z - S[2]), r2 = Math.hypot(E[0] - x, E[1], E[2] - z);
				const a = ((k / (4 * Math.PI)) * (S[1] / r1 + E[1] / r2) * h * h) / (r1 * r2), ph = -k * (r1 + r2 - L);
				(re += a * Math.cos(ph)), (im += a * Math.sin(ph));
			}
		return Math.hypot(re, im) * L;
	};

	it('un tablero mediano refleja como dice la óptica física (±2,5 dB) y una tira fina lejana, casi nada', () => {
		const S = [0, 1, -1], E = [0, 1, -3];
		const one = (x0: number, x1: number, z0: number, z1: number) => {
			const r: NamedTris = { positions: [], materials: [] };
			addBox(r, [x0, -0.02, z0], [x1, 0, z1], 'tabla');
			return run(r, S as [number, number, number], E as [number, number, number], 1).find((p) => p.order === 1)?.fres;
		};
		const mid = one(-0.2, 0.2, -2.2, -1.8)!;
		for (const f of [1000, 2000, 4000, 8000]) expect(Math.abs(db(mid[HF_OCTAVES.indexOf(f)]) - db(po(-0.2, 0.2, -2.2, -1.8, S, E, f)))).toBeLessThan(2.5);
		// tira de 2 cm × 80 cm a 60 cm del punto de rebote: la óptica física da unos −50 dB
		const strip = one(0.6, 0.62, -2.4, -1.6);
		for (const f of [1000, 2000, 4000, 8000]) expect(strip ? db(strip[HF_OCTAVES.indexOf(f)]) : -99).toBeLessThan(-30);
	});

	it('la cara de abajo de un tablero no refleja lo que llega por arriba', () => {
		const r: NamedTris = { positions: [], materials: [] };
		addBox(r, [-1, 0.7, -2.5], [1, 0.73, -1.5], 'mesa');
		const p = run(r, [0, 1.2, -3.2], [0, 1.2, -0.5], 1);
		const ys = p.filter((x) => x.order === 1).map((x) => x.points[1][1]);
		expect(ys.some((y) => Math.abs(y - 0.73) < 1e-6)).toBe(true);
		expect(ys.some((y) => Math.abs(y - 0.7) < 1e-6)).toBe(false);
	});
});
