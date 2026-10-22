// Geometrías sencillas: cajas (para pruebas) y una sala de ejemplo con materiales.
import type { V3 } from './voxel';

export interface NamedTris {
	positions: number[]; // 9 por triángulo, metros, Y arriba
	materials: string[]; // nombre de material por triángulo
}

/** Añade un paralelepípedo (min, max) con 12 triángulos; normales hacia fuera. */
export function addBox(out: NamedTris, mn: V3, mx: V3, mat: string | ((face: string) => string)) {
	const [x0, y0, z0] = mn;
	const [x1, y1, z1] = mx;
	const quads: [string, V3, V3, V3, V3][] = [
		['x-', [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
		['x+', [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]],
		['y-', [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
		['y+', [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]],
		['z-', [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]],
		['z+', [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]
	];
	for (const [face, a, b, c, d] of quads) {
		const m = typeof mat === 'string' ? mat : mat(face);
		out.positions.push(...a, ...b, ...c, ...a, ...c, ...d);
		out.materials.push(m, m);
	}
}

/** Caja vacía (solo superficies interiores) de dimensiones W×H×D con origen en (0,0,0). */
export function shoebox(W: number, H: number, D: number, mat = 'pared'): NamedTris {
	const out: NamedTris = { positions: [], materials: [] };
	addBox(out, [0, 0, 0], [W, H, D], mat);
	return out;
}

/**
 * Sala de ejemplo parecida a un estudio casero: ladrillo con trasdosado de pladur, falso techo,
 * suelo de tarima, puerta, ventana y escritorio. Paredes con grosor. Dimensiones interiores 4,2 × 2,6 × 3,6 m.
 */
export function demoRoom(): NamedTris {
	const out: NamedTris = { positions: [], materials: [] };
	const W = 4.2, H = 2.6, D = 3.6, t = 0.12;
	// suelo y techo (losas con grosor)
	addBox(out, [-t, -t, -t], [W + t, 0, D + t], (f) => (f === 'y+' ? 'Suelo_tarima' : 'Hormigon'));
	addBox(out, [-t, H, -t], [W + t, H + t, D + t], (f) => (f === 'y-' ? 'Falso_techo' : 'Hormigon'));
	// paredes con grosor (cara interior = pladur)
	addBox(out, [-t, 0, -t], [0, H, D + t], (f) => (f === 'x+' ? 'Pladur' : 'Ladrillo'));
	addBox(out, [W, 0, -t], [W + t, H, D + t], (f) => (f === 'x-' ? 'Pladur' : 'Ladrillo'));
	addBox(out, [0, 0, -t], [W, H, 0], (f) => (f === 'z+' ? 'Pladur' : 'Ladrillo'));
	addBox(out, [0, 0, D], [W, H, D + t], (f) => (f === 'z-' ? 'Pladur' : 'Ladrillo'));
	// puerta (pared trasera) y ventana (pared lateral derecha), ligeramente salientes
	addBox(out, [0.3, 0, D - 0.02], [1.12, 2.03, D], 'Puerta');
	addBox(out, [W - 0.02, 1.0, 1.2], [W, 2.2, 2.4], 'Ventana');
	// escritorio (tablero + patas simplificadas en dos paneles laterales)
	addBox(out, [1.2, 0.72, 0.25], [3.0, 0.75, 1.05], 'Escritorio');
	addBox(out, [1.2, 0, 0.25], [1.23, 0.72, 1.05], 'Escritorio');
	addBox(out, [2.97, 0, 0.25], [3.0, 0.72, 1.05], 'Escritorio');
	return out;
}

/** Posiciones por defecto en la sala de ejemplo (Y arriba). */
export const DEMO_POSITIONS = {
	listener: [2.1, 1.2, 1.55] as V3,
	khL: [1.5, 0.95, 0.5] as V3,
	khR: [2.7, 0.95, 0.5] as V3,
	sub: [1.35, 0.2, 0.35] as V3
};
