import { describe, it, expect } from 'vitest';
import { findPaths, pathAmplitude, directivityDb } from './imageSource';
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
		const p = findPaths(tris, triMat, [{ id: 'k', pos: S }], E, { maxOrder: 1 });
		expect(p.some((x) => x.order === 1 && Math.abs(x.points[1][1]) < 1e-6)).toBe(false); // suelo tapado
		expect(p.some((x) => x.order === 1 && Math.abs(x.points[1][1] - 0.62) < 1e-6)).toBe(true); // rebote en la mesa
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
		expect(directivityDb(90, 8000)).toBeLessThan(directivityDb(90, 500) - 8);
		expect(directivityDb(0, 16000)).toBe(0);
	});
});
