import { describe, it, expect } from 'vitest';
import { voxelize } from './voxel';
import { addBox, shoebox } from './testgeo';

describe('aire de la sala', () => {
	// sala de 4 × 2,5 × 5 m con una «cabeza» dibujada (caja cerrada de 30 cm) donde está el oyente
	const room = shoebox(4, 2.5, 5);
	addBox(room, [1.85, 1.05, 2.35], [2.15, 1.35, 2.65], 'cabeza');
	const geo = { tris: Float32Array.from(room.positions), triMat: Int32Array.from(room.materials.map(() => 0)) };

	it('si la cabeza queda dentro de algo dibujado, el aire se busca desde la siguiente semilla', () => {
		const solo = voxelize(geo, 0.1, [2, 1.2, 2.5]);
		expect(solo.airVolume).toBeLessThan(0.1); // solo el hueco de dentro de la cabeza
		const g = voxelize(geo, 0.1, [[2, 1.2, 2.5], [1, 1, 1]]);
		expect(g.airVolume).toBeGreaterThan(40);
		expect(g.leak).toBe(false);
	});

	it('con la cabeza en el aire usa la primera semilla', () => {
		const g = voxelize(geo, 0.1, [[1, 1.2, 1], [2, 1.2, 2.5]]);
		expect(g.airVolume).toBeGreaterThan(40);
	});
});
