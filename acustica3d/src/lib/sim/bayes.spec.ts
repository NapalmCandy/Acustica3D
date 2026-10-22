import { describe, it, expect } from 'vitest';
import { GP, bayesSearch, spreadPoints, expectedImprovement, type P2 } from './bayes';

// "Sala" de 3,4 × 2,8 m con candidatos cada 10 cm
const cands: P2[] = [];
for (let x = 0; x <= 3.4 + 1e-9; x += 0.1) for (let z = 0; z <= 2.8 + 1e-9; z += 0.1) cands.push([x, z]);

// puntuación sintética con varios máximos locales (como los modos de una sala) y el mejor en (2,3; 1,9),
// con un ancho parecido al de los máximos reales (los modos hasta 200 Hz cambian en unos 40 cm)
const score = ([x, z]: P2) =>
	60 +
	22 * Math.exp(-((x - 2.3) ** 2 + (z - 1.9) ** 2) / 0.25) +
	18 * Math.exp(-((x - 0.8) ** 2 + (z - 0.7) ** 2) / 0.3) +
	4 * Math.sin(4 * x) * Math.cos(3 * z);
const trueBest = Math.max(...cands.map(score));

describe('búsqueda bayesiana', () => {
	it('el proceso gaussiano pasa por los puntos medidos y duda lejos de ellos', () => {
		const X: P2[] = [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]];
		const y = X.map(score);
		const gp = GP.fit(X, y);
		for (let i = 0; i < X.length; i++) expect(Math.abs(gp.predict(X[i]).mu - y[i])).toBeLessThan(0.5);
		expect(gp.predict([3, 2.5]).sd).toBeGreaterThan(3 * gp.predict([0.5, 0.5]).sd);
	});

	it('la mejora esperada crece con la media y con la incertidumbre', () => {
		expect(expectedImprovement(80, 1, 70)).toBeGreaterThan(expectedImprovement(72, 1, 70));
		expect(expectedImprovement(70, 5, 70)).toBeGreaterThan(expectedImprovement(70, 1, 70));
		expect(expectedImprovement(50, 1e-12, 70)).toBe(0);
	});

	it('los puntos de partida se reparten por toda la sala', () => {
		const idx = spreadPoints(cands, 8);
		expect(new Set(idx).size).toBe(8);
		const pts = idx.map((i) => cands[i]);
		let minD = Infinity;
		for (let i = 0; i < pts.length; i++) for (let j = 0; j < i; j++) minD = Math.min(minD, Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]));
		expect(minD).toBeGreaterThan(0.8);
	});

	it('encuentra el máximo con muchas menos simulaciones que una rejilla', async () => {
		let n = 0;
		const { y } = await bayesSearch(cands, async (p) => (n++, score(p)), { budget: 30, nInit: 12 });
		expect(n).toBeLessThanOrEqual(30);
		expect(Math.max(...y)).toBeGreaterThan(trueBest - 1);
		// una rejilla de 45 cm (como «Normal») con las mismas simulaciones se queda más lejos
		const grid: P2[] = [];
		for (let x = 0.225; x < 3.4; x += 0.45) for (let z = 0.225; z < 2.8; z += 0.45) grid.push([x, z]);
		expect(grid.length).toBeGreaterThan(n);
		expect(Math.max(...grid.map(score))).toBeLessThan(Math.max(...y));
	});

	it('los puntos sin colocación posible cuentan como los peores y no rompen la búsqueda', async () => {
		const blocked = ([x]: P2) => x < 1.2; // un tercio de la sala sin sitio para los KH
		const { X, y } = await bayesSearch(cands, async (p) => (blocked(p) ? null : score(p)), { budget: 25, nInit: 10 });
		expect(X.length).toBe(y.length);
		expect(Math.max(...y)).toBeGreaterThan(trueBest - 1);
	});
});
