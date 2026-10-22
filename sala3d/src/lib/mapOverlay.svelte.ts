// Imagen del mapa de nivel compartida entre la pestaña "Mapa" y la vista 3D.
import type { V3 } from './sim/voxel';

export interface Overlay {
	canvas: HTMLCanvasElement;
	nx: number;
	nz: number;
	dx: number;
	origin: V3;
	y: number;
}

export const mapOverlay = $state<{ current: Overlay | null }>({ current: null });
