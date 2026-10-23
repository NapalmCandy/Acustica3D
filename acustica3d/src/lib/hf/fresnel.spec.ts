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

	it('la cara de abajo de un tablero no refleja lo que llega por arriba', () => {
		const r: NamedTris = { positions: [], materials: [] };
		addBox(r, [-1, 0.7, -2.5], [1, 0.73, -1.5], 'mesa');
		const p = run(r, [0, 1.2, -3.2], [0, 1.2, -0.5], 1);
		const ys = p.filter((x) => x.order === 1).map((x) => x.points[1][1]);
		expect(ys.some((y) => Math.abs(y - 0.73) < 1e-6)).toBe(true);
		expect(ys.some((y) => Math.abs(y - 0.7) < 1e-6)).toBe(false);
	});
});
