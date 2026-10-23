// Generador de mesas para el banco de pruebas (coordenadas de la app: Y arriba, −Z hacia la pared frontal).
import { addBox, type NamedTris } from '../lib/sim/testgeo';
import type { V3 } from '../lib/sim/voxel';
import { LIBRARY, materialAlpha } from '../lib/acoustics/materials';

export const WOOD = 'Madera DM';
export const PAD = 'Lana Roca 80kg_m3 (mesa)';
export const RUG = 'Alfombra';
const lana = LIBRARY.find((l) => l.id === 'panel_lana_roca')!;
export const EXTRA: Record<string, number[]> = {
	[PAD]: materialAlpha({ ...lana, porous: { thickness_mm: 50, density_kgm3: 80, airgap_mm: 0 } }),
	'Lana Roca 80kg_m3 (mesa 30)': materialAlpha({ ...lana, porous: { thickness_mm: 30, density_kgm3: 80, airgap_mm: 0 } }),
	[RUG]: materialAlpha(LIBRARY.find((l) => l.id === 'alfombra')!),
	'Fieltro': [0.02, 0.03, 0.05, 0.1, 0.2, 0.35, 0.5, 0.55]
};

export interface DeskParams {
	x0: number; x1: number; // ancho
	top: number; // altura del tablero (cara de arriba)
	front: number; back: number; // z del borde delantero (hacia ti) y trasero
	thick?: number;
	/** tablero inclinado: cuánto más alto está el borde trasero que el delantero (m) */
	rise?: number;
	/** pies de los KH: soporte estrecho bajo cada KH (ancho × fondo) en vez de repisa */
	khStand?: { w: number; d: number; plate: number };
	/** repisa corrida para los KH (altura de su cara de arriba y z delantero) */
	khShelf?: { y: number; front: number; back: number };
	/** almohadilla absorbente sobre el tablero: de z0 a z1, grosor (m) y material */
	pad?: { z0: number; z1: number; h: number; mat?: string; x0?: number; x1?: number };
	/** alfombra en el suelo: rectángulo x0..x1, z0..z1 */
	rug?: [number, number, number, number];
	/** patas laterales (paneles) o patas finas */
	legs?: 'paneles' | 'finas';
	kh: { L: V3; R: V3; bottom: number }; // pos. de los KH y altura de su base
}

/** caja que se puede inclinar: el borde trasero sube `rise` (sin caras ocultas) */
function slab(out: NamedTris, x0: number, x1: number, y: number, t: number, zf: number, zb: number, rise: number, mat: string) {
	if (!rise) return addBox(out, [x0, y - t, Math.min(zf, zb)], [x1, y, Math.max(zf, zb)], mat);
	// tablero inclinado como 12 triángulos
	const yf = y, yb = y + rise;
	const P = (x: number, z: number, top: boolean): V3 => [x, (z === zf ? yf : yb) - (top ? 0 : t), z];
	const quad = (a: V3, b: V3, c: V3, d: V3) => { out.positions.push(...a, ...b, ...c, ...a, ...c, ...d); out.materials.push(mat, mat); };
	quad(P(x0, zf, true), P(x1, zf, true), P(x1, zb, true), P(x0, zb, true));
	quad(P(x0, zf, false), P(x0, zb, false), P(x1, zb, false), P(x1, zf, false));
	quad(P(x0, zf, false), P(x1, zf, false), P(x1, zf, true), P(x0, zf, true));
	quad(P(x0, zb, false), P(x0, zb, true), P(x1, zb, true), P(x1, zb, false));
	quad(P(x0, zf, false), P(x0, zf, true), P(x0, zb, true), P(x0, zb, false));
	quad(P(x1, zf, false), P(x1, zb, false), P(x1, zb, true), P(x1, zf, true));
}

export function makeDesk(p: DeskParams): NamedTris {
	const out: NamedTris = { positions: [], materials: [] };
	const t = p.thick ?? 0.025;
	slab(out, p.x0, p.x1, p.top, t, p.front, p.back, p.rise ?? 0, WOOD);
	const zlo = Math.min(p.front, p.back), zhi = Math.max(p.front, p.back);
	if ((p.legs ?? 'paneles') === 'paneles') {
		addBox(out, [p.x0, 0, zlo + 0.05], [p.x0 + 0.025, p.top - t, zhi - 0.05], WOOD);
		addBox(out, [p.x1 - 0.025, 0, zlo + 0.05], [p.x1, p.top - t, zhi - 0.05], WOOD);
	} else
		for (const x of [p.x0 + 0.03, p.x1 - 0.06]) for (const z of [zlo + 0.03, zhi - 0.06]) addBox(out, [x, 0, z], [x + 0.03, p.top - t, z + 0.03], WOOD);
	if (p.khStand)
		for (const k of [p.kh.L, p.kh.R]) {
			const s = p.khStand;
			addBox(out, [k[0] - s.w / 2, p.kh.bottom - s.plate, k[2] - s.d / 2], [k[0] + s.w / 2, p.kh.bottom, k[2] + s.d / 2], WOOD);
			addBox(out, [k[0] - 0.03, 0, k[2] - 0.03], [k[0] + 0.03, p.kh.bottom - s.plate, k[2] + 0.03], WOOD); // columna
			addBox(out, [k[0] - 0.15, 0, k[2] - 0.15], [k[0] + 0.15, 0.02, k[2] + 0.15], WOOD); // base
		}
	if (p.khShelf) {
		const s = p.khShelf;
		addBox(out, [p.x0, s.y - 0.025, Math.min(s.front, s.back)], [p.x1, s.y, Math.max(s.front, s.back)], WOOD);
		for (const x of [p.x0, p.x1 - 0.025]) addBox(out, [x, p.top, Math.min(s.front, s.back)], [x + 0.025, s.y - 0.025, Math.max(s.front, s.back)], WOOD);
	}
	if (p.pad) {
		const d = p.pad;
		addBox(out, [d.x0 ?? p.x0 + 0.03, p.top, Math.min(d.z0, d.z1)], [d.x1 ?? p.x1 - 0.03, p.top + d.h, Math.max(d.z0, d.z1)], d.mat ?? PAD);
	}
	if (p.rug) addBox(out, [p.rug[0], 0, p.rug[2]], [p.rug[1], 0.008, p.rug[3]], RUG);
	return out;
}

/** mueve (y gira hacia atrás `tiltDeg` alrededor del pie) los triángulos de la pantalla */
export function moveScreen(pos: number[], mats: string[], d: V3, tiltDeg = 0, pivot?: V3): number[] {
	const out = pos.slice();
	const a = (tiltDeg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
	for (let t = 0; t < mats.length; t++) {
		if (mats[t] !== 'Pantalla del ordenador') continue;
		for (let v = 0; v < 3; v++) {
			const o = t * 9 + v * 3;
			let y = pos[o + 1], z = pos[o + 2];
			if (tiltDeg && pivot) {
				const dy = y - pivot[1], dz = z - pivot[2];
				// hacia atrás: la parte de arriba se va hacia −Z
				y = pivot[1] + dy * ca + dz * sa;
				z = pivot[2] - dy * sa + dz * ca;
			}
			out[o] = pos[o] + d[0];
			out[o + 1] = y + d[1];
			out[o + 2] = z + d[2];
		}
	}
	return out;
}
