// Objetos que se añaden y mueven dentro de la app (paneles, trampas de graves, muebles…).
// Cajas giradas alrededor del eje vertical, con su propio material acústico.
import type { PorousParams } from '../acoustics/materials';
import type { V3 } from '../sim/voxel';
import type { NamedTris } from '../sim/testgeo';

export interface RoomObject {
	id: string;
	name: string;
	libId: string;
	porous?: PorousParams;
	size: V3; // ancho (X local), alto (Y), fondo (Z local), m
	pos: V3; // centro, coordenadas de la escena (Y arriba)
	rotY: number; // grados
}

export interface ObjectPreset {
	key: string;
	label: string;
	libId: string;
	porous?: PorousParams;
	size: V3;
	height: number; // altura del centro sobre el suelo
}

export const PRESETS: ObjectPreset[] = [
	{ key: 'panel', label: 'Panel absorbente', libId: 'panel_lana_roca', porous: { thickness_mm: 50, density_kgm3: 70, airgap_mm: 0 }, size: [0.6, 1.2, 0.05], height: 1.2 },
	{ key: 'trampa', label: 'Trampa de graves (esquina)', libId: 'panel_lana_roca', porous: { thickness_mm: 300, density_kgm3: 40, airgap_mm: 0 }, size: [0.4, 1.8, 0.4], height: 0.9 },
	{ key: 'mueble', label: 'Mueble / caja de madera', libId: 'madera_mueble', size: [0.8, 0.8, 0.4], height: 0.4 },
	{ key: 'sofa', label: 'Sofá', libId: 'sofa', size: [1.8, 0.8, 0.9], height: 0.4 }
];

export const objectMaterialName = (o: RoomObject) => `◆ ${o.name}`;

/** Triángulos de la caja girada (normales hacia fuera). */
export function objectTris(o: RoomObject): NamedTris {
	const [w, h, d] = o.size;
	const a = (o.rotY * Math.PI) / 180;
	const ca = Math.cos(a), sa = Math.sin(a);
	const P = (x: number, y: number, z: number): V3 => [o.pos[0] + x * ca + z * sa, o.pos[1] + y, o.pos[2] - x * sa + z * ca];
	const x0 = -w / 2, x1 = w / 2, y0 = -h / 2, y1 = h / 2, z0 = -d / 2, z1 = d / 2;
	const quads: [V3, V3, V3, V3][] = [
		[P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0)],
		[P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)],
		[P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)],
		[P(x0, y1, z0), P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0)],
		[P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0), P(x1, y0, z0)],
		[P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)]
	];
	const out: NamedTris = { positions: [], materials: [] };
	const m = objectMaterialName(o);
	for (const [p, q, r, s] of quads) {
		out.positions.push(...p, ...q, ...r, ...p, ...r, ...s);
		out.materials.push(m, m);
	}
	return out;
}
