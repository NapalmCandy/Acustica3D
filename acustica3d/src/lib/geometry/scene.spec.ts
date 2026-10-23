import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { addBox, type NamedTris } from '../sim/testgeo';
import { objectTris, type RoomObject } from './objects';
import { analyzeScene } from './scene';
import { parseSkp, type SkpPart } from './skp';
import type { V3 } from '../sim/voxel';

/** Sala de 4 × 2,6 × 5 m dibujada como en SketchUp: cada capa un grupo, con KH, oyente y tratamiento. */
function drawnRoom() {
	const tris: NamedTris = { positions: [], materials: [] };
	const parts: SkpPart[] = [];
	const triPart: number[] = [];
	const group = (name: string, parent = -1) => (parts.push({ name, parent }), parts.length - 1);
	const box = (p: number, mn: V3, mx: V3, mat: string) => {
		const n = tris.materials.length;
		addBox(tris, mn, mx, mat);
		for (let i = n; i < tris.materials.length; i++) triPart.push(p);
	};
	const obj = (p: number, o: RoomObject, mat: string) => {
		const t = objectTris(o);
		tris.positions.push(...t.positions);
		for (let i = 0; i < t.materials.length; i++) tris.materials.push(mat), triPart.push(p);
	};
	// paredes del fondo (z = 0 y z = −5): pladur + lana + ladrillo; laterales: pladur + cámara + ladrillo
	for (const [z0, s] of [[0, 1], [-5, -1]] as const) {
		box(group('pladur'), [0, 0, Math.min(z0, z0 + s * 0.015)], [4, 2.6, Math.max(z0, z0 + s * 0.015)], 'Pladur');
		box(group('lana'), [0, 0, Math.min(z0 + s * 0.03, z0 + s * 0.07)], [4, 2.6, Math.max(z0 + s * 0.03, z0 + s * 0.07)], 'RockWool SonoRock ECO');
		box(group('ladrillo'), [-0.2, 0, Math.min(z0 + s * 0.1, z0 + s * 0.2)], [4.2, 2.6, Math.max(z0 + s * 0.1, z0 + s * 0.2)], 'Ladrillo hueco doble');
	}
	for (const [x0, s] of [[0, -1], [4, 1]] as const) {
		box(group('pladur'), [Math.min(x0, x0 + s * 0.015), 0, -5], [Math.max(x0, x0 + s * 0.015), 2.6, 0], 'Pladur');
		box(group('ladrillo'), [Math.min(x0 + s * 0.05, x0 + s * 0.15), 0, -5.2], [Math.max(x0 + s * 0.05, x0 + s * 0.15), 2.6, 0.2], 'Ladrillo hueco doble');
	}
	box(group('techo'), [0, 2.6, -5], [4, 2.615, 0], 'Pladur');
	box(group('lana techo'), [0, 2.75, -5], [4, 2.79, 0], 'RockWool SonoRock ECO');
	box(group('forjado'), [-0.2, 2.95, -5.2], [4.2, 3.25, 0.2], 'Hormigón');
	box(group('suelo'), [-0.2, -0.3, -5.2], [4.2, 0, 0.2], 'Hormigón');
	// KH (dos grupos dentro de uno) y la persona sentada en su silla
	const kh = group('Monitores');
	box(group('izq', kh), [1.2, 0.9, -4.2], [1.38, 1.18, -3.99], 'Neumann Altavoz');
	box(group('der', kh), [2.6, 0.9, -4.2], [2.78, 1.18, -3.99], 'Neumann Altavoz');
	// rejillas del izquierdo: woofer centrado en 1,0 m y tweeter en 1,12 m
	box(group('woofer', kh), [1.24, 0.95, -3.99], [1.34, 1.05, -3.98], 'Neumann rejilla');
	box(group('tweeter', kh), [1.27, 1.1, -3.99], [1.31, 1.14, -3.98], 'Neumann rejilla');
	const silla = group('Silla Estudio');
	box(group('cuerpo', silla), [1.8, 0.5, -2.9], [2.2, 1.3, -2.6], 'Oyente');
	box(group('ojos', silla), [1.95, 1.2, -2.95], [2.05, 1.22, -2.9], 'eyeBall');
	box(group('asiento', silla), [1.7, 0, -2.9], [2.3, 0.5, -2.4], '[Color_007]');
	// mesa con una franja de lana encima (parte de la mesa: se queda fija)
	const mesa = group('Mesa acustica');
	box(group('Tablero', mesa), [1.2, 0.7, -3.9], [2.8, 0.73, -3.1], 'Madera DM');
	box(group('Absorbente de la mesa', mesa), [1.25, 0.73, -3.6], [2.75, 0.78, -3.3], 'Lana Roca 80kg_m3');
	// trampa en diagonal en una esquina y un panel plano con 5 cm de cámara
	obj(group('Grupo#259'), { id: 't', name: 't', libId: '', size: [0.55, 1.3, 0.13], pos: [3.8, 0.65, -0.2], rotY: 45 }, 'Lana de roca 80kg/m3');
	obj(group('Trampa'), { id: 'p', name: 'p', libId: '', size: [1, 0.6, 0.1], pos: [0.1, 1.2, -3], rotY: 90 }, 'Lana de roca 80kg/m3');
	return { tris, parts, triPart: Int32Array.from(triPart) };
}

describe('lo dibujado en el .skp', () => {
	const m = drawnRoom();
	const s = analyzeScene(m.tris, m.parts, m.triPart);

	it('los KH dibujados pasan a ser las fuentes (izquierdo y derecho vistos desde la cabeza)', () => {
		expect(s.devices.khL![0]).toBeCloseTo(1.29, 2);
		expect(s.devices.khR![0]).toBeCloseTo(2.69, 2);
		expect(s.devices.khL![1]).toBeCloseTo(1.06, 2); // entre woofer (1,0) y tweeter (1,12)
		expect(s.devices.khR![1]).toBeCloseTo(1.18 - 0.125, 2); // sin rejillas: como un KH 120 A
		expect(s.tris.materials).not.toContain('Neumann Altavoz');
	});

	it('la cabeza es la posición de escucha, y la persona y su silla se quitan', () => {
		const L = s.devices.listener!;
		expect(L[1]).toBeCloseTo(1.16, 2); // 5 cm por debajo de los ojos
		expect(L[2]).toBeGreaterThan(-2.95); // las orejas, por detrás de los ojos (lejos de los KH)
		for (const mat of ['Oyente', 'eyeBall', '[Color_007]']) expect(s.tris.materials).not.toContain(mat);
		expect(s.devices.sub![1]).toBeCloseTo(0.2, 2); // en el suelo, bajo el KH izquierdo
	});

	it('trampas y paneles de lana pasan a ser objetos con su grosor, cámara y densidad', () => {
		expect(s.objects).toHaveLength(2);
		const trap = s.objects.find((o) => o.name.startsWith('Trampa de esquina'))!;
		const panel = s.objects.find((o) => o.name.startsWith('Panel'))!;
		expect(Math.abs(trap.rotY) % 90).toBeCloseTo(45, 0);
		expect(trap.porous!.thickness_mm).toBeCloseTo(130, -1);
		expect(panel.porous!.thickness_mm).toBeCloseTo(100, -1);
		expect(panel.porous!.airgap_mm).toBeCloseTo(50, -1);
		expect(panel.porous!.density_kgm3).toBe(80);
		expect(s.tris.materials).not.toContain('Lana de roca 80kg/m3');
	});

	it('la lana de una mesa se queda fija con ella (no pasa a ser un panel que se mueve)', () => {
		expect(s.objects.some((o) => o.pos[1] < 0.8 && o.pos[2] < -3.2 && o.pos[2] > -3.7)).toBe(false);
		expect(s.tris.materials).toContain('Lana Roca 80kg_m3');
		expect(s.notes.some((n) => n.includes('lana de la mesa'))).toBe(true);
	});

	it('los objetos guardan la forma dibujada y, sin moverlos, quedan exactamente donde estaban', () => {
		const lana: number[] = [];
		m.tris.materials.forEach((mat, t) => {
			if (mat === 'Lana de roca 80kg/m3') for (let k = 0; k < 9; k++) lana.push(m.tris.positions[t * 9 + k]);
		});
		const back = s.objects.flatMap((o) => objectTris(o).positions);
		expect(back.length).toBe(lana.length);
		const key = (a: number[]) => {
			const pts: string[] = [];
			for (let i = 0; i < a.length; i += 3) pts.push(a.slice(i, i + 3).map((v) => v.toFixed(2)).join(','));
			return pts.sort();
		};
		expect(key(back)).toEqual(key(lana));
	});

	it('cada superficie toma el material de sus capas', () => {
		expect(Object.entries(s.libHints).sort()).toEqual([
			['Pladur (falso techo con plénum de 34 cm y lana)', 'falso_techo_pladur'],
			['Pladur (pared con cámara de 4 cm sin lana)', 'pladur_camara'],
			['Pladur (pared con lana)', 'pladur_trasdosado']
		]);
	});

	const real = process.env.SKP_FILE;
	it.skipIf(!real || !existsSync(real))('reconoce lo dibujado en un .skp real', async () => {
		const r = await parseSkp(new Uint8Array(readFileSync(real!)));
		const sc = analyzeScene(r.tris, r.parts, r.triPart);
		console.log(sc.devices, sc.objects.map((o) => `${o.name} ${o.size} ${o.pos} ${o.rotY}/${o.rotX ?? 0} ${JSON.stringify(o.porous)}`), sc.libHints, sc.notes);
		expect(sc.tris.materials.length).toBeGreaterThan(0);
	});
});
