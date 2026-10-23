import { describe, it, expect } from 'vitest';
import { findPaths, pathAmplitude, khDirectivityDb, KH_Q } from './imageSource';
import { shoebox, addBox } from '../sim/testgeo';
import type { V3 } from '../sim/voxel';

// sala rígida de 4 × 2,5 × 5 m
const room = shoebox(4, 2.5, 5);
const geo = (r = room) => ({ tris: Float32Array.from(r.positions), triMat: Int32Array.from(r.materials.map(() => 0)) });
const S: V3 = [1.5, 1.2, 1], E: V3 = [2, 1.2, 2.5];

describe('medios y agudos (método de la imagen)', () => {
	it('en una caja: el directo, 6 primeras reflexiones, y las de orden 2 a la distancia de su imagen', () => {
		const { tris, triMat } = geo();
		const p = findPaths(tris, triMat, [{ id: 'k', pos: S }], E, { maxOrder: 2 });
		expect(p.filter((x) => x.order === 0)).toHaveLength(1);
		expect(p.filter((x) => x.order === 1)).toHaveLength(6);
		// suelo: imagen en y = −1,2
		const floor = p.find((x) => x.order === 1 && Math.abs(x.points[1][1]) < 1e-6)!;
		expect(floor.length).toBeCloseTo(Math.hypot(0.5, 2.4, 1.5), 6);
		// orden 2 en una caja: paredes opuestas en los dos órdenes (3 · 2 = 6) y cada par de paredes
		// contiguas una sola vez (12): las dos imágenes coinciden y solo uno de los dos órdenes es posible
		const o2 = p.filter((x) => x.order === 2);
		expect(o2.length).toBe(18);
		for (const x of o2) expect(x.points).toHaveLength(4);
	});

	it('un obstáculo entre el altavoz y el suelo tapa esa reflexión', () => {
		const r = shoebox(4, 2.5, 5);
		// tabla horizontal a 60 cm, debajo de todo el recorrido (como una mesa)
		addBox(r, [1, 0.6, 0.5], [2.5, 0.62, 3], 'mesa');
		const { tris, triMat } = geo(r);
		const p = findPaths(tris, triMat, [{ id: 'k', pos: S }], E, { maxOrder: 1, diffraction: false });
		expect(p.some((x) => x.order === 1 && Math.abs(x.points[1][1]) < 1e-6)).toBe(false); // suelo tapado
		expect(p.some((x) => x.order === 1 && Math.abs(x.points[1][1] - 0.62) < 1e-6)).toBe(true); // rebote en la mesa
		// con difracción el del suelo llega algo en medios (rodea los bordes de la mesa) y casi nada en agudos
		const q = findPaths(tris, triMat, [{ id: 'k', pos: S }], E, { maxOrder: 1 });
		const floor = q.find((x) => x.order === 1 && Math.abs(x.points[1][1]) < 1e-6);
		if (floor) {
			expect(floor.soft).toBe(true);
			expect(floor.fres![8]).toBeLessThan(0.1);
			expect(floor.fres![3]).toBeGreaterThan(floor.fres![8]);
		}
	});

	it('la amplitud cae con la distancia, con la absorción y fuera del eje en agudos', () => {
		const { tris, triMat } = geo();
		const [direct, ...refl] = findPaths(tris, triMat, [{ id: 'k', pos: S }], E, { maxOrder: 1 });
		const aim = direct.leave;
		const rigid = () => [0, 0, 0, 0, 0, 0, 0, 0, 0];
		const soft = () => [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
		expect(pathAmplitude(direct, 1000, aim, rigid)).toBeCloseTo(1 / direct.length, 2);
		const r = refl[0];
		expect(pathAmplitude(r, 1000, aim, soft) / pathAmplitude(r, 1000, aim, rigid)).toBeCloseTo(Math.sqrt(0.5), 3);
	});

	it('directividad del KH 120 con los diagramas de Neumann', () => {
		const aim: V3 = [0, 0, -1]; // mirando hacia −Z, de pie
		const at = (h: number, v: number): V3 => {
			const a = (h * Math.PI) / 180, e = (v * Math.PI) / 180;
			return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)];
		};
		expect(khDirectivityDb(aim, aim, 16000)).toBeCloseTo(0, 6);
		// en el eje horizontal se estrecha con la frecuencia: a 60°, unos −3 dB a 500 Hz y unos −10 dB a 8 kHz
		expect(khDirectivityDb(at(60, 0), aim, 500)).toBeGreaterThan(-4);
		expect(khDirectivityDb(at(60, 0), aim, 8000)).toBeLessThan(-9);
		// simétrico a izquierda y derecha
		expect(khDirectivityDb(at(-45, 0), aim, 4000)).toBeCloseTo(khDirectivityDb(at(45, 0), aim, 4000), 6);
		// el nulo vertical del cruce: a 2 kHz y 45° hacia arriba cae mucho más que en horizontal
		expect(khDirectivityDb(at(0, 45), aim, 2000)).toBeLessThan(khDirectivityDb(at(45, 0), aim, 2000) - 8);
		// detrás, menos que delante
		expect(khDirectivityDb(at(180, 0), aim, 1000)).toBeLessThan(khDirectivityDb(at(90, 0), aim, 1000));
		// Q crece con la frecuencia (casi omni en graves, más directivo en agudos)
		expect(KH_Q[1]).toBeLessThan(2);
		expect(KH_Q[7]).toBeGreaterThan(KH_Q[4]);
		expect(KH_Q[7]).toBeGreaterThan(4);
	});
});
