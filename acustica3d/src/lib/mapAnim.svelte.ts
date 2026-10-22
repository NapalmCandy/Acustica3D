// Barrido de frecuencias precalculado del mapa de la sala (para la animación).
// Los datos grandes van en un objeto normal (no reactivo); `anim` solo avisa del progreso.

export const anim = $state({ reqId: 0, ready: 0, total: 0 });

export const animData = {
	freqs: [] as number[],
	ids: [] as string[],
	nCells: 0,
	ix: new Int32Array(0),
	iz: new Int32Array(0),
	nx: 0,
	nz: 0,
	/** por fuente: fotogramas × celdas */
	re: [] as Float32Array[],
	im: [] as Float32Array[]
};

/** Frecuencia más alta que el mapa muestra con fiabilidad para una simulación hasta `fmax`. */
export const mapFMax = (fmax: number) => Math.min(300, 0.86 * fmax);
