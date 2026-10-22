import { describe, it, expect } from 'vitest';
import { computeScores, cellResponse, nearestCell, wallCriteria, type PlaneSpectra } from './score';
import { objectTris, type RoomObject } from '../geometry/objects';
import type { Cx } from '../acoustics/speakers';

/** Plano sintético de 9×9 celdas, una sola fuente; `db(c, f)` da la respuesta de cada celda. */
function plane(db: (c: number, f: number) => number): PlaneSpectra {
	const freqs: number[] = [];
	for (let f = 20; f <= 250; f *= Math.pow(2, 1 / 12)) freqs.push(f);
	const nx = 9, nz = 9, nC = nx * nz, nF = freqs.length;
	const ix = new Int32Array(nC), iz = new Int32Array(nC), wall = new Float32Array(nC);
	const re = new Float32Array(nC * nF), im = new Float32Array(nC * nF);
	for (let c = 0; c < nC; c++) {
		ix[c] = c % nx;
		iz[c] = Math.floor(c / nx);
		wall[c] = Math.min(ix[c], iz[c], nx - 1 - ix[c], nz - 1 - iz[c]) * 0.1 + 0.05;
		for (let k = 0; k < nF; k++) re[c * nF + k] = Math.pow(10, db(c, freqs[k]) / 20);
	}
	const late = new Float32Array(nC * nF).fill(1e-3);
	return { freqs, ids: ['khL'], re: [re], im: [im], lateRe: [late], lateIm: [late], ix, iz, wallDist: wall, nx, nz, dx: 0.1, origin: [0, 0, 0], y: 1.2 };
}
const unity = (): Cx => [1, 0];
// altavoces 1 m por delante del plano de prueba: todas sus celdas son posiciones de escucha posibles
const geom = { khL: [-0.3, 1.2, -1] as [number, number, number], khR: [1.2, 1.2, -1] as [number, number, number], listener: [0.45, 1.2, 0.4] as [number, number, number] };
const onlyAcoustic = { plano: 1, huecos: 1, picos: 1, retumbe: 0, robustez: 0, simetria: 0, paredes: 0, geometria: 0 };

describe('mapa de mejor posición', () => {
	it('una celda con un hueco puntúa peor que una plana', () => {
		const dip = 40; // celda (4,4)
		const ps = plane((c, f) => (c === dip && f > 60 && f < 90 ? -15 : 0));
		const s = computeScores(ps, unity, onlyAcoustic, geom, { band: [20, 250], minWallDist: 0 });
		expect(s.total[dip]).toBeLessThan(s.total[41] - 5);
		expect(s.parts.huecos[dip]).toBeGreaterThan(0);
		expect(s.parts.huecos[41]).toBe(0);
	});

	it('el rango de frecuencias decide qué cuenta (hueco a 25 Hz fuera de 40–200 Hz no penaliza)', () => {
		const dip = 40;
		const ps = plane((c, f) => (c === dip && f < 28 ? -20 : 0));
		const all = computeScores(ps, unity, onlyAcoustic, geom, { band: [20, 250], minWallDist: 0 });
		const hc = computeScores(ps, unity, onlyAcoustic, geom, { band: [40, 200], minWallDist: 0 });
		expect(all.total[dip]).toBeLessThan(all.total[41] - 2);
		expect(Math.abs(hc.total[dip] - hc.total[41])).toBeLessThan(1e-3);
	});

	it('las celdas pegadas a la pared no son candidatas', () => {
		const s = computeScores(plane(() => 0), unity, onlyAcoustic, geom, { minWallDist: 0.3 });
		expect(Number.isNaN(s.total[0])).toBe(true); // esquina
		expect(Number.isFinite(s.total[40])).toBe(true); // centro
	});

	it('la geometría favorece el triángulo equilátero delante de los altavoces', () => {
		const ps = plane(() => 0);
		const s = computeScores(ps, unity, { plano: 0, huecos: 0, picos: 0, retumbe: 0, robustez: 0, simetria: 0, paredes: 0, geometria: 1 }, geom, { minWallDist: 0 });
		// el mejor punto debe quedar centrado entre los dos KH (x ≈ 0,45 m)
		expect(Math.abs(s.bestPos[0] - 0.45)).toBeLessThan(0.11);
	});

	it('no propone sitios pegados a los altavoces, entre ellos o detrás', () => {
		const near = { ...geom, khL: [0.2, 1.2, 0.45] as [number, number, number], khR: [0.7, 1.2, 0.45] as [number, number, number], listener: [0.45, 1.2, 0.85] as [number, number, number] };
		// plano pequeño (0,9 m): se baja la distancia mínima a 0,4 m para que quede algún sitio válido
		const s = computeScores(plane(() => 0), unity, onlyAcoustic, near, { minWallDist: 0, minListenDist: 0.4 });
		const at = (x: number, z: number) => s.total[z * 9 + x];
		expect(Number.isNaN(at(4, 4))).toBe(true); // entre los dos altavoces
		expect(Number.isNaN(at(4, 1))).toBe(true); // detrás
		expect(Number.isNaN(at(4, 5))).toBe(true); // a 0,27 m y con 136° de apertura
		expect(Number.isFinite(at(4, 8))).toBe(true); // centrado, a 0,47 m y con 64° de apertura
	});

	it('no propone sitios al lado de un altavoz (fuera de la apertura o descentrados)', () => {
		// KH a 1 m del plano; celdas en la fila más cercana, muy a un lado
		const g2 = { khL: [0.3, 1.2, -0.2] as [number, number, number], khR: [0.6, 1.2, -0.2] as [number, number, number], listener: [0.45, 1.2, 0.3] as [number, number, number] };
		const s = computeScores(plane(() => 0), unity, onlyAcoustic, g2, { minWallDist: 0, minListenDist: 0.2 });
		expect(Number.isNaN(s.total[0 * 9 + 8])).toBe(true); // esquina lejana del lado derecho: descentrado
		expect(Number.isFinite(s.total[3 * 9 + 4])).toBe(true); // centrado
	});

	it('imagen estéreo: centrado entre paredes y lejos de ellas es mejor que pegado a una pared', () => {
		// sala de 4 × 5 m (máscara de 40 × 50 celdas de 10 cm), oyente mirando hacia z = 0
		const nx = 40, nz = 50;
		const room = { nx, nz, dx: 0.1, origin: [0, 0, 0] as [number, number, number], mask: new Uint8Array(nx * nz).fill(1) };
		const centro = wallCriteria(room, 2.0, 2.0, 2.0, 0.5);
		const lateral = wallCriteria(room, 0.4, 2.0, 0.4, 0.5);
		const fondo = wallCriteria(room, 2.0, 4.6, 2.0, 3.0);
		expect(centro.sideAsym).toBeLessThan(0.05);
		expect(centro.near).toBe(0);
		expect(lateral.sideAsym).toBeGreaterThan(0.9); // 0,4 m a un lado y 3,6 m al otro
		expect(lateral.near).toBeGreaterThan(0.9);
		expect(fondo.near).toBeGreaterThan(0.9); // la pared de detrás a 0,4 m
		expect(fondo.sideAsym).toBeLessThan(0.05);
	});

	it('cellResponse y nearestCell', () => {
		const ps = plane((c, f) => (c === 22 ? 6 : 0) + (f > 100 ? -3 : 0));
		const r = cellResponse(ps, unity, 22);
		expect(r[0]).toBeCloseTo(6, 3);
		expect(r[r.length - 1]).toBeCloseTo(3, 3);
		expect(nearestCell(ps, [0.45, 1.2, 0.25])).toBe(2 * 9 + 4);
	});
});

describe('objetos', () => {
	it('caja girada: 12 triángulos y huella correcta', () => {
		const o: RoomObject = { id: 'a', name: 'Panel', libId: 'panel_lana_roca', size: [0.6, 1.2, 0.05], pos: [1, 1.2, 2], rotY: 90 };
		const t = objectTris(o);
		expect(t.materials.length).toBe(12);
		const xs = t.positions.filter((_, i) => i % 3 === 0), zs = t.positions.filter((_, i) => i % 3 === 2);
		// girada 90°: el ancho de 0,6 m queda a lo largo de Z
		expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(0.6, 5);
		expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(0.05, 5);
	});
});
