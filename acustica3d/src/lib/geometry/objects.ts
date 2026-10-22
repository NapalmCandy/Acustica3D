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
	/** inclinación (grados) alrededor del eje X local, antes del giro en Y: trampas en diagonal entre
	 *  pared y techo (o suelo). */
	rotX?: number;
	/** forma exacta dibujada en SketchUp (9 números por triángulo, en ejes locales: centrada en `pos` y
	 *  sin los giros). Sin ella, el objeto es una caja de `size`. Si se cambia `size`, se escala. */
	mesh?: number[];
	/** `size` cuando se guardó `mesh` (para escalarla) */
	meshSize?: V3;
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

/** Triángulos del objeto en ejes locales centrados (sin girar ni mover). */
export function objectLocalTris(o: Pick<RoomObject, 'size' | 'mesh' | 'meshSize'>): V3[][] {
	if (o.mesh) {
		const ms = o.meshSize ?? o.size;
		const k = o.size.map((v, i) => (ms[i] > 1e-6 ? v / ms[i] : 1));
		const out: V3[][] = [];
		for (let i = 0; i < o.mesh.length; i += 9)
			out.push([0, 3, 6].map((j) => [o.mesh![i + j] * k[0], o.mesh![i + j + 1] * k[1], o.mesh![i + j + 2] * k[2]] as V3));
		return out;
	}
	const [w, h, d] = o.size;
	const x0 = -w / 2, x1 = w / 2, y0 = -h / 2, y1 = h / 2, z0 = -d / 2, z1 = d / 2;
	const quads: V3[][] = [
		[[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
		[[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]],
		[[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
		[[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]],
		[[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]],
		[[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]
	];
	return quads.flatMap(([p, q, r, s]) => [[p, q, r], [p, r, s]]);
}

/** Triángulos del objeto girado y colocado (normales hacia fuera). */
export function objectTris(o: RoomObject): NamedTris {
	const a = (o.rotY * Math.PI) / 180;
	const ca = Math.cos(a), sa = Math.sin(a);
	const b = ((o.rotX ?? 0) * Math.PI) / 180;
	const cb = Math.cos(b), sb = Math.sin(b);
	const out: NamedTris = { positions: [], materials: [] };
	const m = objectMaterialName(o);
	for (const tri of objectLocalTris(o)) {
		for (const [x, y0, z0] of tri) {
			const y = y0 * cb - z0 * sb, z = y0 * sb + z0 * cb; // inclinación en X (como Three.js)
			out.positions.push(o.pos[0] + x * ca + z * sa, o.pos[1] + y, o.pos[2] - x * sa + z * ca);
		}
		out.materials.push(m);
	}
	return out;
}
