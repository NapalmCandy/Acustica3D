// Estado global de la aplicación (Svelte 5, runas).
import type * as THREE from 'three';
import { LIBRARY, materialAlpha, alphaToBeta, lowFreqAlpha, porousProduct, type PorousParams } from './acoustics/materials';
import type { NamedTris } from './sim/testgeo';
import type { V3 } from './sim/voxel';
import type { Spectrum } from './dsp/analysis';
import { objectTris, objectMaterialName, PRESETS, type RoomObject } from './geometry/objects';
import { DEFAULT_WEIGHTS, type Criterion, type PlaneSpectra } from './analysis/score';
import type { OptConfig } from './sim/optimize';
import type { Bounds } from './sim/treatment';

export interface OptState {
	running: boolean;
	phase: string;
	done: number;
	total: number;
	frac: number;
	testing: V3 | null;
	tested: { pos: V3; score: number }[];
	top: OptConfig[];
	current: OptConfig | null;
	/** tu colocación actual, solo cambiando los ajustes */
	currentTuned: OptConfig | null;
	footprint: { mask: Uint8Array; nx: number; nz: number; dx: number; origin: V3 } | null;
	engine: string;
	nSub: number;
	/** con «mover también trampas y paneles»: dónde quedan, la caja de la sala y qué ha cambiado */
	layout: RoomObject[] | null;
	bounds: Bounds | null;
	log: string[];
	elapsedS: number | null;
	error: string | null;
}
export const emptyOpt = (): OptState => ({
	running: false, phase: '', done: 0, total: 0, frac: 0, testing: null, tested: [], top: [], current: null, currentTuned: null,
	footprint: null, engine: '', nSub: 0, elapsedS: null, error: null, layout: null, bounds: null, log: []
});

export type DeviceId = 'khL' | 'khR' | 'sub' | 'listener';

export interface MatAssign {
	libId: string;
	porous?: PorousParams;
	/** el que tenía antes de desmarcar «cuenta» (para volver a él) */
	prevLibId?: string;
}

export interface SimResult {
	fs: number;
	fmax: number;
	K: number;
	grid: { nx: number; ny: number; nz: number; dx: number; airVolume: number; leak: boolean; leakPoint: V3 | null };
	/** funciones de transferencia sala por fuente y receptor */
	tf: Record<string, Spectrum[]>;
	receivers: V3[];
	areaByMat: Map<string, number>;
	plane: { nx: number; nz: number; y: number; dx: number; origin: V3 } | null;
	elapsedS: number;
	positionsAtRun: Record<DeviceId, V3>;
}

/** Asignación automática por palabras clave en el nombre del material de SketchUp. */
export function guessMaterial(name: string): string {
	const n = name.toLowerCase();
	const rules: [RegExp, string][] = [
		[/panel|lana|rockwool|absorb|trampa|bass ?trap/, 'panel_lana_roca'],
		[/techo|ceil|plafon|escayola/, 'falso_techo_pladur'],
		[/pladur|trasdos|yeso|drywall|gypsum|tabique/, 'pladur_trasdosado'],
		[/ladrill|brick|obra/, 'ladrillo'],
		[/hormig|concrete|baldosa|azulejo|ceram|porcel|gres|tile/, 'hormigon'],
		[/suelo|tarima|parquet|floor|madera_suelo|laminad/, 'tarima'],
		[/alfombra|carpet|moqueta/, 'alfombra'],
		[/ventan|crista|vidrio|glass|window/, 'cristal'],
		[/puerta|door/, 'puerta'],
		[/mesa|escritorio|desk|mueble|estant|armario|madera|wood|mdf/, 'madera_mueble'],
		[/sofa|sofá|sillon|sillón|couch|cama|bed/, 'sofa'],
		[/pantalla|screen|monitor ?pc|samsung|logo|televis/, 'pantalla'],
		[/altavoz|speaker|neumann|studio ?monitor|monitor de estudio|persona|oyente|human|silla|chair|eyeball|cota|dimension|guide|guía/, 'ignorar']
	];
	for (const [re, id] of rules) if (re.test(n)) return id;
	return 'pladur_trasdosado';
}

class AppState {
	modelName = $state<string | null>(null);
	modelObject = $state.raw<THREE.Object3D | null>(null);
	tris = $state.raw<NamedTris | null>(null);
	materialNames = $state<string[]>([]);
	warnings = $state<string[]>([]);
	/** lo que se ha reconocido y ajustado al importar (informativo) */
	notes = $state<string[]>([]);
	bbox = $state<{ min: V3; max: V3 } | null>(null);
	matMap = $state<Record<string, MatAssign>>({});

	positions = $state<Record<DeviceId, V3>>({
		khL: [1.5, 0.95, 0.5],
		khR: [2.7, 0.95, 0.5],
		sub: [1.35, 0.2, 0.35],
		listener: [2.1, 1.2, 1.55]
	});
	/** equipo seleccionado o "obj:<id>" para un objeto añadido */
	selected = $state<DeviceId | `obj:${string}` | null>(null);
	objects = $state<RoomObject[]>([]);
	private objCounter = 0;

	kh = $state({ satHpf85: false, bassDb: 0, lowMidDb: 0, trebleDb: 0 });
	sub = $state({ enabled: true, xoverHz: 85, polarityInvert: false, gainDb: 0, extraDelayMs: 0 });

	sim = $state({ fmax: 350, ppw: 10, durationS: 1.5, areaHalf: 0.25 });
	running = $state(false);
	progress = $state({ stage: '', frac: 0 });
	error = $state<string | null>(null);
	/** datos para depurar el último fallo del cálculo (se pueden copiar) */
	errorDebug = $state<string | null>(null);
	result = $state.raw<SimResult | null>(null);
	spectra = $state.raw<PlaneSpectra | null>(null);
	level = $state<{ i: number; n: number; fmax: number; engine: string; dx: number } | null>(null);
	engine = $state<'auto' | 'gpu' | 'cpu'>('auto');
	autoSim = $state(true);
	weights = $state<Record<Criterion, number>>({ ...DEFAULT_WEIGHTS });
	scoreLayer = $state<'total' | Criterion>('total');
	/** rango de frecuencias (Hz) que cuenta para elegir el mejor sitio */
	band = $state<[number, number]>([40, 200]);
	/** distancia de escucha (m, media a los dos KH) que se considera posible */
	listenRange = $state<[number, number]>([0.7, 2.5]);
	/** colocación automática */
	opt = $state.raw<OptState>(emptyOpt());
	optOptions = $state({
		facings: 'todas' as 'todas' | 'actual', sub: 'cualquiera' as 'cualquiera' | 'cerca', precision: 'normal' as 'rapida' | 'normal' | 'fina',
		apertures: 'varias' as 'varias' | 'equilatero', tuneSub: true, tuneKh: true,
		method: 'bayes' as 'bayes' | 'rejilla', treatment: true
	});
	/** celda del mapa bajo el ratón (vista previa de su respuesta), −1 = ninguna */
	hoverCell = $state(-1);

	view = $state({ hideCeiling: true, wallOpacity: 0.85, showMap: true });
	resultsTab = $state<'mejor' | 'colocar' | 'respuesta' | 'decaimiento' | 'mapa' | 'materiales'>('mejor');
	smoothing = $state(12); // 1/12 oct
	mapFreq = $state(60);
	mapBand = $state(true);

	/** `hints`: material de la biblioteca ya decidido para algunos materiales (p. ej. por sus capas). */
	setModel(name: string, object: THREE.Object3D, tris: NamedTris, mats: string[], warnings: string[], bbox: { min: V3; max: V3 }, hints: Record<string, string> = {}, notes: string[] = []) {
		this.notes = notes;
		this.modelName = name;
		this.modelObject = object;
		this.tris = tris;
		this.materialNames = mats;
		this.warnings = warnings;
		this.bbox = bbox;
		const mm: Record<string, MatAssign> = {};
		for (const m of mats) {
			const prev = this.matMap[m];
			const libId = prev?.libId ?? hints[m] ?? guessMaterial(m);
			const lib = LIBRARY.find((l) => l.id === libId)!;
			// lana de un producto conocido: su densidad y resistividad de ficha
			const prod = porousProduct(m);
			const porous = lib.porous ? { ...lib.porous, ...(prod ? { density_kgm3: prod.density_kgm3, flowRes: prod.flowRes } : {}) } : undefined;
			mm[m] = { libId, porous: prev?.porous ?? porous };
		}
		this.matMap = mm;
		this.result = null;
	}

	addObject(key: string) {
		const pr = PRESETS.find((p) => p.key === key)!;
		const floor = this.bbox ? this.bbox.min[1] : 0;
		const L = this.positions.listener;
		// aparece a 1 m por delante del oyente (hacia los altavoces) para encontrarlo fácilmente
		const id = String(++this.objCounter) + '-' + Date.now().toString(36);
		const n = this.objects.filter((o) => o.name.startsWith(pr.label)).length + 1;
		this.objects.push({
			id, name: `${pr.label} ${n}`, libId: pr.libId, porous: pr.porous ? { ...pr.porous } : undefined,
			size: [...pr.size] as V3, pos: [L[0] + 0.8, floor + pr.height, L[2]], rotY: 0
		});
		this.selected = `obj:${id}`;
	}

	removeObject(id: string) {
		this.objects = this.objects.filter((o) => o.id !== id);
		if (this.selected === `obj:${id}`) this.selected = null;
	}

	objectAlpha(o: RoomObject): number[] {
		const lib = LIBRARY.find((l) => l.id === o.libId)!;
		return lib.kind === 'porous' ? materialAlpha({ ...lib, porous: o.porous ?? lib.porous }) : materialAlpha(lib);
	}

	alphaOf(skpName: string): number[] {
		const obj = this.objects.find((o) => objectMaterialName(o) === skpName);
		if (obj) return this.objectAlpha(obj);
		const a = this.matMap[skpName];
		const lib = LIBRARY.find((l) => l.id === (a?.libId ?? 'pladur_trasdosado'))!;
		if (lib.kind === 'porous') return materialAlpha({ ...lib, porous: a?.porous ?? lib.porous });
		return materialAlpha(lib);
	}

	/** Proyecto: todo menos la geometría (el modelo se vuelve a cargar desde SketchUp). */
	exportProject() {
		return {
			app: 'Acustica3D', version: 1, modelName: this.modelName,
			matMap: $state.snapshot(this.matMap), positions: $state.snapshot(this.positions),
			kh: $state.snapshot(this.kh), sub: $state.snapshot(this.sub), sim: $state.snapshot(this.sim),
			objects: $state.snapshot(this.objects) as RoomObject[] | undefined,
			weights: $state.snapshot(this.weights) as Record<Criterion, number> | undefined,
			band: $state.snapshot(this.band) as [number, number] | undefined,
			listenRange: $state.snapshot(this.listenRange) as [number, number] | undefined
		};
	}

	importProject(p: ReturnType<AppState['exportProject']>) {
		if (p?.app !== 'Acustica3D' && p?.app !== 'Sala3D') throw new Error('No es un proyecto de Acustica3D.'); // Sala3D: nombre antiguo
		for (const [k, v] of Object.entries(p.matMap ?? {})) if (this.matMap[k] || !this.materialNames.length) this.matMap[k] = v;
		this.positions = p.positions;
		// proyectos antiguos no traen los interruptores del KH
		this.kh = Object.assign({ satHpf85: false, bassDb: 0, lowMidDb: 0, trebleDb: 0 }, p.kh);
		this.sub = p.sub;
		this.sim = p.sim;
		// un proyecto sin objetos (p. ej. de antes de reconocer las trampas del .skp) no borra los del modelo
		if (p.objects?.length) this.objects = p.objects;
		if (p.weights) this.weights = { ...DEFAULT_WEIGHTS, ...p.weights };
		if (p.band) this.band = p.band;
		if (p.listenRange) this.listenRange = p.listenRange;
		this.result = null;
	}

	snapshotPositions(): Record<DeviceId, V3> {
		return $state.snapshot(this.positions) as Record<DeviceId, V3>;
	}

	/** Datos de entrada para la simulación de graves. */
	simInput() {
		if (!this.tris) throw new Error('Carga primero un modelo o la sala de ejemplo.');
		const objs = $state.snapshot(this.objects) as RoomObject[];
		const names = [...this.materialNames, ...objs.map(objectMaterialName)];
		const ignore = new Set(this.materialNames.filter((n) => this.matMap[n]?.libId === 'ignorar'));
		const positions = [...this.tris.positions];
		const mats = [...this.tris.materials];
		for (const o of objs) {
			const t = objectTris(o);
			positions.push(...t.positions);
			mats.push(...t.materials);
		}
		const triMat = Int32Array.from(mats.map((m) => (ignore.has(m) ? -1 : names.indexOf(m))));
		const betaByMat = names.map((n) => alphaToBeta(lowFreqAlpha(this.alphaOf(n), this.sim.fmax)));
		// copias planas: los proxies reactivos de Svelte no se pueden enviar al worker
		const pos = $state.snapshot(this.positions);
		const L = pos.listener;
		const h = this.sim.areaHalf;
		const receivers: V3[] = [L];
		for (const dxz of [[-h, 0], [h, 0], [0, -h], [0, h], [-h, -h], [h, -h], [-h, h], [h, h]])
			receivers.push([L[0] + dxz[0], L[1], L[2] + dxz[1]]);
		const sources = [
			{ id: 'khL', pos: pos.khL },
			{ id: 'khR', pos: pos.khR },
			...(this.sub.enabled ? [{ id: 'sub', pos: pos.sub }] : [])
		];
		return {
			tris: Float32Array.from(positions), triMat, betaByMat, names,
			// para mover los objetos en la colocación automática: la sala fija va primero
			nStatic: this.tris.materials.length, objects: objs, objMat: objs.map((o) => names.indexOf(objectMaterialName(o))),
			fmax: this.sim.fmax, ppw: this.sim.ppw, durationS: this.sim.durationS,
			// el aire de la sala se busca desde la cabeza; si está dentro de algo dibujado, desde los KH o el centro
			seed: [L, pos.khL, pos.khR, ...(this.bbox ? [[0, 1, 2].map((k) => (this.bbox!.min[k] + this.bbox!.max[k]) / 2) as V3] : [])],
			sources, receivers, planeY: L[1]
		};
	}

	/** Estimación de celdas y tiempo de cálculo. */
	estimate() {
		if (!this.bbox) return null;
		const dx = 343 / (this.sim.fmax * this.sim.ppw);
		const s = [0, 1, 2].map((k) => this.bbox!.max[k] - this.bbox!.min[k]);
		const cells = s.reduce((a, b) => a * (b / dx + 4), 1);
		const steps = this.sim.durationS * (343 * Math.sqrt(3)) / dx;
		const nSrc = this.sub.enabled ? 3 : 2;
		const seconds = (cells * steps * nSrc) / 1.2e8; // ~120 M celdas·paso/s en un PC normal (estimado)
		return { dx, cells, steps, seconds };
	}
}

export const app = new AppState();

/** Coordenadas de SketchUp (Z arriba, Y hacia el fondo) ↔ Three.js (Y arriba). */
export const toSketchup = (p: V3): V3 => [p[0], -p[2], p[1]];
export const fromSketchup = (p: V3): V3 => [p[0], p[2], -p[1]];
