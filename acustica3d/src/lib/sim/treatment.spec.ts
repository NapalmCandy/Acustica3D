import { describe, it, expect } from 'vitest';
import { placePanels, trapSlots, atSlot, collides, objectAabb, roomBounds, type Bounds } from './treatment';
import { shoebox } from './testgeo';
import type { RoomObject } from '../geometry/objects';

const b: Bounds = { lo: [0, 0, -6.66], hi: [4.12, 2.67, 0] };
const porous = { thickness_mm: 100, density_kgm3: 80, airgap_mm: 50 };
// como en el dibujo: dos paneles en las paredes laterales, uno en el techo
const panels: RoomObject[] = [
	{ id: 'p1', name: 'Panel 1', libId: 'panel_lana_roca', porous, size: [1, 0.6, 0.1], pos: [0.1, 1.27, -5.1], rotY: 90 },
	{ id: 'p2', name: 'Panel 2', libId: 'panel_lana_roca', porous, size: [1, 0.6, 0.1], pos: [4.02, 1.27, -5.1], rotY: 90 },
	{ id: 'p3', name: 'Panel 3', libId: 'panel_lana_roca', porous: { ...porous, airgap_mm: 30 }, size: [1, 0.1, 0.6], pos: [2.06, 2.59, -5.1], rotY: 0 }
];
// trampas: 8 verticales en diagonal en las esquinas (dos alturas) y 2 tumbadas entre pared y techo
const trapP = { thickness_mm: 129, density_kgm3: 80, airgap_mm: 53 };
const vert = (i: number, x: number, z: number, y: number, rotY: number): RoomObject => ({ id: `v${i}`, name: `Trampa de esquina ${i}`, libId: 'panel_lana_roca', porous: trapP, size: [0.548, 1.338, 0.129], pos: [x, y, z], rotY });
const traps: RoomObject[] = [
	vert(1, 3.913, -6.539, 0.669, -31), vert(2, 3.913, -6.539, 2.006, -31), vert(3, 0.207, -0.101, 2.006, -31), vert(4, 0.207, -0.101, 0.669, -31),
	vert(5, 4.019, -0.207, 2.006, 59), vert(6, 4.019, -0.207, 0.669, 59), vert(7, 0.101, -6.433, 0.669, 59), vert(8, 0.101, -6.433, 2.006, 59),
	{ id: 'h9', name: 'Trampa de esquina 9', libId: 'panel_lana_roca', porous: trapP, size: [1.338, 0.129, 0.548], pos: [2.06, 2.59, -6.433], rotY: 0, rotX: -31 },
	{ id: 'h10', name: 'Trampa de esquina 10', libId: 'panel_lana_roca', porous: trapP, size: [1.338, 0.129, 0.548], pos: [2.06, 2.59, -0.207], rotY: 0, rotX: 31 }
];
// la caja girada de una trampa en diagonal asoma por detrás hasta ~12 cm dentro de pared o techo (como
// en el dibujo): esa parte cae en lo macizo y no cambia la simulación
const inside = (o: RoomObject, tol = 0.15) => {
	const a = objectAabb(o);
	return [0, 1, 2].every((k) => a.lo[k] >= b.lo[k] - tol && a.hi[k] <= b.hi[k] + tol);
};

describe('tratamiento', () => {
	it('la caja de la sala sale de lanzar rayos desde dentro', () => {
		const r = roomBounds(Float32Array.from(shoebox(4, 2.5, 5).positions), 12, [2, 1.2, 2.5])!;
		expect(r.lo.map((v) => +v.toFixed(3))).toEqual([0, 0, 0]);
		expect(r.hi.map((v) => +v.toFixed(3))).toEqual([4, 2.5, 5]);
	});

	it('los paneles van a las primeras reflexiones de cada KH en su pared y entre ellas en el techo', () => {
		// mirando hacia −Z (0°): la izquierda es x = 0
		const cfg = { listener: [2.06, 1.2, -3.5] as [number, number, number], khL: [1.4, 1.2, -4.6] as [number, number, number], khR: [2.72, 1.2, -4.6] as [number, number, number], facing: 0 };
		const out = placePanels(panels, cfg, b);
		const [l, r, c] = out;
		// izquierda: a medio camino en z entre el KH (−4,6) y la imagen de la cabeza, más cerca del KH
		expect(l.pos[0]).toBeCloseTo(0.1, 2); // conserva su cámara de 5 cm
		expect(l.pos[2]).toBeLessThan(-3.5);
		expect(l.pos[2]).toBeGreaterThan(-4.6);
		expect(r.pos[0]).toBeCloseTo(4.02, 2);
		expect(r.pos[2]).toBeCloseTo(l.pos[2], 1); // simétrico
		expect(c.pos[1]).toBeCloseTo(2.67 - 0.03 - 0.05, 2);
		expect(c.pos[0]).toBeCloseTo(2.06, 2);
		for (const o of out) expect(inside(o, 0.01)).toBe(true);
	});

	it('los huecos para trampas copian las posturas del dibujo a esquinas y aristas, dentro de la sala', () => {
		const slots = trapSlots(traps, b);
		// las 10 actuales (8 en esquinas, 2 en aristas con el techo) y más huecos en aristas
		expect(slots.filter((s) => s.kind === 'esquina')).toHaveLength(8);
		expect(slots.filter((s) => s.kind === 'techo').length).toBeGreaterThan(4);
		expect(slots.filter((s) => s.kind === 'suelo').length).toBeGreaterThan(4);
		for (const s of slots) expect(inside(atSlot(traps[0], s))).toBe(true);
		// en el sitio de cada trampa hay un hueco con su misma postura
		for (const t of traps) expect(slots.some((s) => Math.hypot(s.pos[0] - t.pos[0], s.pos[1] - t.pos[1], s.pos[2] - t.pos[2]) < 0.05 && s.rotY === t.rotY)).toBe(true);
	});

	it('una trampa tumbada en una arista lateral queda pegada a la pared y al techo, sin salirse', () => {
		const side = trapSlots(traps, b).filter((s) => s.kind === 'techo' && s.pos[0] < 0.5);
		expect(side.length).toBeGreaterThanOrEqual(2);
		for (const s of side) {
			const o = atSlot(traps[8], s);
			const a = objectAabb(o);
			expect(a.lo[0]).toBeLessThan(0.03); // toca la pared
			expect(a.hi[1]).toBeGreaterThan(2.64); // y el techo
			expect(o.pos[1]).toBeCloseTo(traps[8].pos[1], 3); // a la misma altura que la del dibujo
			expect(inside(o)).toBe(true);
		}
	});

	it('detecta choques entre objetos', () => {
		expect(collides(traps[0], traps)).toBe(false); // con la de encima solo se toca; con ella misma no cuenta
		expect(collides({ ...traps[0], id: 'x' }, [traps[0]])).toBe(true);
		expect(collides(traps[0], [traps[2]])).toBe(false);
	});
});
