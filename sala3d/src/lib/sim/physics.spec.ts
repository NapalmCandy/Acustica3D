import { describe, it, expect } from 'vitest';
import { voxelize, type Geometry, type V3 } from './voxel';
import { prepare, run, C } from './fdtd';
import { roomTF, magnitudeCurve, decayBands } from '../dsp/analysis';
import { shoebox, demoRoom } from './testgeo';
import { alphaToBeta, randomIncidenceAlpha, porousAlphaOctaves, LIBRARY, materialAlpha } from '../acoustics/materials';
import { khResponse, cabs } from '../acoustics/speakers';

function geoFrom(nt: { positions: number[]; materials: string[] }, names: string[]): Geometry {
	return {
		tris: Float32Array.from(nt.positions),
		triMat: Int32Array.from(nt.materials.map((m) => names.indexOf(m)))
	};
}

describe('materiales', () => {
	it('alphaToBeta invierte la absorción aleatoria', () => {
		for (const a of [0.02, 0.1, 0.3, 0.6]) {
			const b = alphaToBeta(a);
			const back = randomIncidenceAlpha({ re: 1 / b, im: 0 });
			expect(Math.abs(back - a)).toBeLessThan(0.005);
		}
	});
	it('panel de lana de roca: absorbe poco en grave y mucho en medios', () => {
		const a = porousAlphaOctaves({ thickness_mm: 50, density_kgm3: 70, airgap_mm: 0 });
		expect(a[1]).toBeLessThan(0.35); // 125 Hz
		expect(a[3]).toBeGreaterThan(0.6); // 500 Hz (modelo de reacción local: algo conservador)
		const thick = porousAlphaOctaves({ thickness_mm: 100, density_kgm3: 70, airgap_mm: 100 });
		expect(thick[1]).toBeGreaterThan(a[1]); // más grosor y cámara → más grave
	});
	it('todos los materiales tienen 8 bandas válidas', () => {
		for (const m of LIBRARY) {
			const al = materialAlpha(m);
			expect(al.length).toBe(8);
			for (const v of al) expect(v >= 0 && v <= 1).toBe(true);
		}
	});
});

describe('altavoces', () => {
	it('KH 120 A: -3 dB cerca de 52 Hz y -6 dB cerca de 46 Hz (datos de Neumann)', () => {
		const db = (f: number) => 20 * Math.log10(cabs(khResponse(f, { satHpf85: false })));
		expect(Math.abs(db(52) + 3)).toBeLessThan(0.6);
		expect(Math.abs(db(46) + 6)).toBeLessThan(0.6);
		expect(Math.abs(db(300))).toBeLessThan(0.6);
	});
});

describe('simulación de ondas (FDTD)', () => {
	it('campo libre: 0 dB a 1 m (sonido directo antes de la primera reflexión)', () => {
		const L = 7;
		const nt = shoebox(L, L, L, 'pared');
		const geo = geoFrom(nt, ['pared']);
		const fmax = 300;
		const dx = C / (fmax * 10);
		const src: V3 = [L / 2, L / 2, L / 2];
		const rcv: V3 = [L / 2 + 1, L / 2, L / 2];
		const grid = voxelize(geo, dx, src);
		expect(grid.leak).toBe(false);
		const prep = prepare(grid, geo, [0]);
		const out = run({ prep, source: src, receivers: [rcv], durationS: 0.03, fmax, planeY: null });
		// ventana temporal: hasta antes de la primera reflexión (fuente a 3,5 m de las paredes → camino ≥ 6 m)
		const ir = out.irs[0];
		const tCut = Math.floor(0.012 * out.fs) + out.pulse.length;
		const gated = new Float32Array(ir.length);
		for (let i = 0; i < Math.min(tCut, ir.length); i++) {
			const w = i > tCut * 0.8 ? 0.5 + 0.5 * Math.cos((Math.PI * (i - tCut * 0.8)) / (tCut * 0.2)) : 1;
			gated[i] = ir[i] * w;
		}
		// distancia real entre centros de celda (puede no ser 1 m exacto)
		const rc = out.receiverCells[0], sc = out.sourceCell;
		const dist = Math.hypot(rc[0] - sc[0], rc[1] - sc[1], rc[2] - sc[2]) * grid.dx;
		const tf = roomTF(gated, out.pulse, out.fs, out.K, fmax);
		const curve = magnitudeCurve(tf, 120, 250, 12, 3);
		const expected = -20 * Math.log10(dist);
		for (const v of curve.db) expect(Math.abs(v - expected)).toBeLessThan(1.0);
	}, 60000);

	it('sala rígida 4 × 2,5 × 3 m: modos en c/2L', () => {
		const W = 4, H = 2.5, D = 3;
		const nt = shoebox(W, H, D, 'pared');
		const geo = geoFrom(nt, ['pared']);
		const fmax = 200;
		const dx = C / (fmax * 12);
		const src: V3 = [0.3, 0.3, 0.3];
		const rcv: V3 = [W - 0.35, H - 0.35, D - 0.35];
		const grid = voxelize(geo, dx, rcv);
		// casi rígida: β pequeño para que los picos sean nítidos pero el resultado acabe decayendo
		const prep = prepare(grid, geo, [0.003]);
		const out = run({ prep, source: src, receivers: [rcv], durationS: 3.0, fmax, planeY: null });
		const tf = roomTF(out.irs[0], out.pulse, out.fs, out.K, fmax);
		const c = magnitudeCurve(tf, 30, 100, 96, 0);
		// picos locales
		const peaks: number[] = [];
		for (let i = 1; i < c.db.length - 1; i++) if (c.db[i] > c.db[i - 1] && c.db[i] > c.db[i + 1]) peaks.push(c.f[i]);
		// el volumen discretizado no es exacto: comparamos con el tamaño efectivo de la rejilla de aire
		const modes = [C / (2 * W), C / (2 * D), C / (2 * H), Math.hypot(C / (2 * W), C / (2 * D))];
		for (const m of modes) {
			const near = peaks.reduce((b, p) => (Math.abs(p - m) < Math.abs(b - m) ? p : b), Infinity);
			expect(Math.abs(near - m) / m).toBeLessThan(0.025);
		}
	}, 120000);

	it('sala de ejemplo: cerrada, sin fugas, y la absorción acorta el decaimiento', () => {
		const nt = demoRoom();
		const names = [...new Set(nt.materials)];
		const geo = geoFrom(nt, names);
		const fmax = 200;
		const dx = C / (fmax * 10);
		const seed: V3 = [2.1, 1.2, 1.55];
		const grid = voxelize(geo, dx, seed);
		expect(grid.leak).toBe(false);
		expect(Math.abs(grid.airVolume - 4.2 * 2.6 * 3.6) / (4.2 * 2.6 * 3.6)).toBeLessThan(0.08);
		const rigid = prepare(grid, geo, names.map(() => 0.01));
		const damped = prepare(grid, geo, names.map(() => 0.1));
		const src: V3 = [1.5, 0.95, 0.5];
		const a = run({ prep: rigid, source: src, receivers: [seed], durationS: 1.5, fmax, planeY: null });
		const b = run({ prep: damped, source: src, receivers: [seed], durationS: 1.5, fmax, planeY: null });
		const ta = decayBands(roomTF(a.irs[0], a.pulse, a.fs, a.K, fmax), [63, 125])[1].t20 ?? 0;
		const tb = decayBands(roomTF(b.irs[0], b.pulse, b.fs, b.K, fmax), [63, 125])[1].t20 ?? 0;
		expect(tb).toBeLessThan(ta);
		// Sabine aproximado para la sala amortiguada: misma escala de magnitud
		const V = grid.airVolume;
		const S = 2 * (4.2 * 2.6 + 4.2 * 3.6 + 2.6 * 3.6);
		const alpha = randomIncidenceAlpha({ re: 1 / 0.1, im: 0 });
		const sabine = (0.161 * V) / (S * alpha);
		expect(tb / sabine).toBeGreaterThan(0.4);
		expect(tb / sabine).toBeLessThan(2.5);
	}, 120000);
});

describe('reciprocidad (base de la colocación automática)', () => {
	it('fuente en A medida en B = fuente en B medida en A, con paredes absorbentes', () => {
		const nt = shoebox(3.1, 2.4, 3.7, 'pared');
		const geo = geoFrom(nt, ['pared']);
		const fmax = 200;
		const dx = C / (fmax * 8);
		const A: V3 = [0.9, 1.2, 1.1], B: V3 = [2.2, 0.3, 2.9];
		const grid = voxelize(geo, dx, A);
		const prep = prepare(grid, geo, [alphaToBeta(0.2)]);
		const ab = run({ prep, source: A, receivers: [B], durationS: 0.4, fmax, planeY: null }).irs[0];
		const ba = run({ prep, source: B, receivers: [A], durationS: 0.4, fmax, planeY: null }).irs[0];
		let e = 0, d = 0;
		for (let i = 0; i < ab.length; i++) {
			e += ab[i] * ab[i];
			d += (ab[i] - ba[i]) ** 2;
		}
		// diferencia < −60 dB respecto a la señal (solo redondeo de coma flotante)
		expect(10 * Math.log10(d / e)).toBeLessThan(-60);
	});
});
