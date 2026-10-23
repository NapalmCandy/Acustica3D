// Banco de agudos: mesa paramétrica con el triángulo de 60°, medida por tramos (0,3–3 kHz y 3–16 kHz).
// Variantes en la variable de entorno VARS (separadas por comas); triángulo en TRI = {"E":[x,y,z],"D":d}.
import { it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { loadScene, alphaTable, assemble, evaluate, FREQS } from './hfeval';
import { EXTRA, moveScreen } from './desk';
import { g, extrude, loft, triangle, sources, cabinets, annulus, arcToLine, box, arc, type G } from './desk3';
import { porousSurfaceImpedance, randomIncidenceAlpha, OCTAVES, LIBRARY, materialAlpha } from '../lib/acoustics/materials';
import type { V3 } from '../lib/sim/voxel';
// @ts-ignore (módulo JS del repositorio)
import { collect, mesaArco, ARCO } from '../../../mesa/gen_mesas.mjs';

const OUT = '/tmp/claude-0/-home-user-Acustica3D/67763e73-2314-5de2-9c39-bfbb4f041583/scratchpad/agudos/';
EXTRA['Caja KH'] = [0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02];
EXTRA['Frente KH'] = Array(8).fill(0.999);
EXTRA['Plástico duro'] = [0.02, 0.03, 0.03, 0.03, 0.03, 0.03, 0.02, 0.02];
const W = 'Madera DM';
/** retícula de listones sobre lana (ver estetica): abierta σ, lana de grosor mm */
function holedAlpha(d: number, t: number, sig: number, woolMm: number): number[] {
	const rho = 1.204, c0 = 343, eta = 1.8e-5;
	const wool = materialAlpha({ ...LIBRARY.find((l) => l.id === 'panel_lana_roca')!, porous: { thickness_mm: woolMm, density_kgm3: 80, airgap_mm: 0 } });
	return OCTAVES.map((f, i) => {
		const w = 2 * Math.PI * f;
		const z = porousSurfaceImpedance(f, { thickness_mm: woolMm, density_kgm3: 80, airgap_mm: 0 });
		const kk = (d / 2) * Math.sqrt((w * rho) / eta);
		const r = ((8 * eta * t) / (sig * rho * c0 * (d / 2) ** 2)) * Math.sqrt(1 + (kk * kk) / 32);
		const fok = Math.max(0.05, 1 - 1.47 * Math.sqrt(sig) + 0.47 * sig ** 1.5);
		const x = (w * (t + 0.85 * d * fok)) / (sig * c0);
		const lumped = randomIncidenceAlpha({ re: z.re + r, im: z.im + x });
		const kd = (w / c0) * d, b = Math.min(1, Math.max(0, kd - 1));
		return lumped * (1 - b) + sig * wool[i] * b;
	});
}
const woolA = (mm: number) => materialAlpha({ ...LIBRARY.find((l) => l.id === 'panel_lana_roca')!, porous: { thickness_mm: mm, density_kgm3: 80, airgap_mm: 0 } }).slice(0, 8);
EXTRA['Retícula 81 %'] = holedAlpha(0.054, 0.019, 0.81, 31);
EXTRA['Retícula 90 %'] = holedAlpha(0.057, 0.019, 0.9, 31);
EXTRA['Lana 3 cm'] = woolA(30);
EXTRA['Lana 5 cm'] = woolA(50);
EXTRA['Fieltro 1 cm'] = woolA(10);
EXTRA['Moqueta'] = [0.02, 0.04, 0.08, 0.2, 0.35, 0.4, 0.45, 0.5]; // moqueta de pelo corto sobre el suelo

interface P {
	bridge: 'puente' | 'pies' | 'ninguno'; // puente corrido, un pie por KH o nada
	over: number; // cuánto sobresale el frontal del KH del canto (m)
	bevel: number; // canto delantero achaflanado hacia abajo y atrás (alto del chaflán, m; 0 = canto recto)
	topMat: string; // acabado del puente delante y alrededor de los KH
	screen: 'colgada' | 'pie' | 'ninguna'; // colgada a ras del puente (centro 1,10) o con su pie en un rebaje
	shelf: null | { y: number; r0: number; r1: number; a: number; tilt?: number; win: null | { r0: number; r1: number; a: number; mat: string; fins?: { pitch: number; t: number } } };
	tray: boolean;
	trayW?: number; trayDepth?: number; trayMat?: string; // fondo de la bandeja (desde el oído) y alfombrilla encima
	sub?: [number, number]; // Sub8 en el suelo (x, z de la app), 30 × 33 × 30 cm
	slats?: number; // frente de listones retranqueado esta distancia del canto (m)
	inst?: 'teclado' | 'pad';
	edgeFelt?: number; // canto delantero del puente forrado de fieltro (fondo, m)
	front?: boolean; // frente del puente: tela sobre lana de 3 cm, de 15 cm del suelo hasta el tablero
	floor?: string; // lana o alfombra en el suelo donde rebota el sonido (bajo la mesa)
}
const base: P = { bridge: 'puente', over: 0, bevel: 0, topMat: W, screen: 'pie', shelf: { y: 0.76, r0: 0.45, r1: 0.88, a: 52, win: { r0: 0.52, r1: 0.84, a: 44, mat: 'Retícula 81 %' } }, tray: true };
const AL: NonNullable<P['shelf']> = { ...base.shelf!, win: { ...base.shelf!.win!, mat: 'Lana 3 cm', fins: { pitch: 0.04, t: 0.003 } } };
/** la buena, con la balda a la medida del triángulo: ventana centrada en el punto de rebote (a D/2 del oído) */
const DD = JSON.parse(process.env.TRI ?? '{"D":1.37}').D as number;
const BUENA = (tilt: number, over: number): Partial<P> => {
	const c = Math.max(0.62, DD / 2), r0 = c - 0.21, r1 = Math.min(c + 0.2, DD - 0.3);
	return { over, shelf: { y: 0.77, r0: r0 - 0.03, r1: r1 + 0.02, a: 52, tilt, win: { r0, r1, a: 49, mat: 'Lana 3 cm', fins: { pitch: 0.04, t: 0.003 } } } };
};
const SUB = JSON.parse(process.env.SUB ?? 'null');
const FINAL = (): Partial<P> => ({ ...BUENA(8, 0.03), slats: 0.12, sub: SUB ?? undefined });
const V: Record<string, Partial<P> | 'sin mesa'> = {
	'sin mesa': 'sin mesa',
	'puente recto': {},
	'puente con KH 3 cm fuera': { over: 0.03 },
	'puente con KH 6 cm fuera': { over: 0.06 },
	'puente con chaflán 4 cm': { bevel: 0.04 },
	'puente con KH 3 cm fuera y chaflán 6 cm': { over: 0.03, bevel: 0.06 },
	'puente con fieltro': { topMat: 'Fieltro 1 cm' },
	'pies (sin puente entre KH)': { bridge: 'pies' },
	'pies + chaflán 6 cm': { bridge: 'pies', bevel: 0.06 },
	'sin puente (KH flotando) + balda': { bridge: 'ninguno' },
	'balda toda madera': { shelf: { ...base.shelf!, win: null } },
	'balda retícula 90 %': { shelf: { ...base.shelf!, win: { ...base.shelf!.win!, mat: 'Retícula 90 %' } } },
	'balda lana abierta': { shelf: { ...base.shelf!, win: { ...base.shelf!.win!, mat: 'Lana 3 cm' } } },
	'sin balda': { shelf: null },
	'sin balda ni bandeja': { shelf: null, tray: false },
	'pantalla colgada': { screen: 'colgada' },
	'balda aletas 3 mm cada 40 mm sobre lana': { shelf: { ...base.shelf!, win: { ...base.shelf!.win!, mat: 'Lana 3 cm', fins: { pitch: 0.04, t: 0.003 } } } },
	'balda aletas 6 mm cada 40 mm sobre lana': { shelf: { ...base.shelf!, win: { ...base.shelf!.win!, mat: 'Lana 3 cm', fins: { pitch: 0.04, t: 0.006 } } } },
	'balda retícula inclinada 8°': { shelf: { ...base.shelf!, tilt: 8 } },
	'balda aletas 3 mm inclinada 8°': { shelf: { ...base.shelf!, tilt: 8, win: { ...base.shelf!.win!, mat: 'Lana 3 cm', fins: { pitch: 0.04, t: 0.003 } } } },
	'suelo con lana 5 cm': { floor: 'Lana 5 cm' },
	'balda aletas 3 mm + suelo con lana': { floor: 'Lana 5 cm', shelf: { ...base.shelf!, win: { ...base.shelf!.win!, mat: 'Lana 3 cm', fins: { pitch: 0.04, t: 0.003 } } } },
	'sin mesa + suelo con lana': { bridge: 'ninguno', shelf: null, tray: false, screen: 'pie', floor: 'Lana 5 cm' },
	'sin mesa + moqueta': { bridge: 'ninguno', shelf: null, tray: false, screen: 'pie', floor: 'Moqueta' },
	'aletas': { shelf: AL },
	'aletas + moqueta': { shelf: AL, floor: 'Moqueta' },
	'aletas + alfombrilla de fieltro': { shelf: AL, trayMat: 'Fieltro 1 cm' },
	'aletas + bandeja corta (45 cm)': { shelf: AL, trayDepth: 0.45 },
	'aletas + bandeja corta + alfombrilla + moqueta': { shelf: AL, trayDepth: 0.45, trayMat: 'Fieltro 1 cm', floor: 'Moqueta' },
	'aletas con ventana grande': { shelf: { ...AL, win: { ...AL.win!, r0: 0.48, r1: 0.86, a: 49 } } },
	'aletas inclinada 6°': { shelf: { ...AL, tilt: 6 } },
	'aletas inclinada 12°': { shelf: { ...AL, tilt: 12 } },
	'pies + aletas': { bridge: 'pies', shelf: AL },
	'aletas + KH 3 cm fuera': { shelf: AL, over: 0.03 },
	'aletas inclinada 12° + ventana grande': { shelf: { ...AL, tilt: 12, win: { ...AL.win!, r0: 0.48, r1: 0.86, a: 49 } } },
	'aletas 12° + ventana grande + KH 3 cm fuera': { over: 0.03, shelf: { ...AL, tilt: 12, win: { ...AL.win!, r0: 0.48, r1: 0.86, a: 49 } } },
	'aletas 12° + ventana grande + frente de tela': { front: true, shelf: { ...AL, tilt: 12, win: { ...AL.win!, r0: 0.48, r1: 0.86, a: 49 } } },
	'aletas 12° + ventana grande + pies': { bridge: 'pies', shelf: { ...AL, tilt: 12, win: { ...AL.win!, r0: 0.48, r1: 0.86, a: 49 } } },
	'aletas 8° + ventana grande': { shelf: { ...AL, tilt: 8, win: { ...AL.win!, r0: 0.48, r1: 0.86, a: 49 } } },
	'buena 8°': BUENA(8, 0), 'buena 8° + KH 3 cm fuera': BUENA(8, 0.03), 'buena 12° + KH 3 cm fuera': BUENA(12, 0.03), 'buena 5° + KH 3 cm fuera': BUENA(5, 0.03),
	'buena 8° + KH 3 cm fuera + moqueta': { ...BUENA(8, 0.03), floor: 'Moqueta' },
	'final': FINAL(), 
	'final sin frente': { ...FINAL(), slats: undefined }, 'final + teclado MIDI': { ...FINAL(), inst: 'teclado' }, 'final + pad': { ...FINAL(), inst: 'pad' },
	'final + moqueta': { ...FINAL(), floor: 'Moqueta' },
	'F': { ...FINAL(), slats: undefined }, 'F KH 6 cm fuera': { ...FINAL(), slats: undefined, over: 0.06 }, 'F canto de fieltro': { ...FINAL(), slats: undefined, edgeFelt: 0.05 },
	'F KH 6 cm fuera + canto de fieltro': { ...FINAL(), slats: undefined, over: 0.06, edgeFelt: 0.05 }, 'F listones a 30 cm': { ...FINAL(), slats: 0.3 },
	'F canto de fieltro + listones a 30 cm': { ...FINAL(), slats: 0.3, edgeFelt: 0.05 }, 'final bandeja 110 cm': { ...FINAL(), trayW: 0.55 }
};
/** sector de corona con el tablero inclinado: y(r) = y0 + (r − r0)·tan(tilt) (sube hacia los KH) */
function sector(o: G, E: V3, r0: number, r1: number, a0: number, a1: number, yTop: (r: number) => number, th: number, mat: string, step = 3) {
	const n = Math.max(1, Math.ceil((a1 - a0) / step));
	for (let i = 0; i < n; i++) {
		const aa = a0 + ((a1 - a0) * i) / n, ab = a0 + ((a1 - a0) * (i + 1)) / n;
		const q = (r: number, a: number, dy: number): [number, number, number] => { const [x, z] = arc(E, r, a); return [x, yTop(r) + dy, z]; };
		loft(o, [q(r0, aa, -th), q(r0, ab, -th), q(r1, ab, -th), q(r1, aa, -th)], [q(r0, aa, 0), q(r0, ab, 0), q(r1, ab, 0), q(r1, aa, 0)], mat);
	}
}

function desk(t: ReturnType<typeof triangle>, p: P): G {
	const o = g(), E = t.E, y = E[1] - 0.17; // apoyo de los KH: eje a 17 cm de la base (manual)
	const T = 0.025;
	const xc = E[0], half = Number(process.env.HALF ?? t.S / 2 + 0.38); // de lado a lado: 38 cm más allá de cada KH
	const rKH = t.D; // radio del frontal de los KH (desde el oído)
	const zBack = Math.min(t.khL[2], t.khR[2]) - 0.43; // fondo del puente
	const rEdge = rKH - p.over; // canto delantero (arco centrado en el oído)
	const ang = (x: number, r: number) => (Math.asin(Math.max(-1, Math.min(1, (x - xc) / r))) * 180) / Math.PI;
	const top = (mat: string, r: number, x0: number, x1: number) => {
		if (!p.edgeFelt) return arcToLine(o, E, r, zBack, x0, x1, y - T, y, mat);
		annulus(o, E, r, r + p.edgeFelt, ang(x0, r), ang(x1, r), y - T, y, 'Fieltro 1 cm', 2);
		arcToLine(o, E, r + p.edgeFelt, zBack, x0, x1, y - T, y, mat);
	};
	const bevel = (x0: number, x1: number) => {
		if (!p.bevel) return;
		// chaflán de 45°: del canto (r, y−T) baja hasta (r + bevel, y − T − bevel), por debajo del tablero
		const n = Math.ceil((x1 - x0) / 0.03);
		for (let i = 0; i < n; i++) {
			const xa = x0 + ((x1 - x0) * i) / n, xb = x0 + ((x1 - x0) * (i + 1)) / n;
			const zf = (x: number, r: number) => E[2] - Math.sqrt(Math.max(0, r * r - (x - E[0]) ** 2));
			const a = (x: number, r: number, yy: number): [number, number, number] => [x, yy, zf(x, r)];
			const b = p.bevel;
			loft(o, [a(xa, rEdge + b, y - T - b), a(xb, rEdge + b, y - T - b), a(xb, rEdge + b + 0.02, y - T - b), a(xa, rEdge + b + 0.02, y - T - b)],
				[a(xa, rEdge, y - T), a(xb, rEdge, y - T), a(xb, rEdge + 0.02, y - T), a(xa, rEdge + 0.02, y - T)], W);
		}
	};
	if (p.bridge === 'puente') {
		// tablero (con un rebaje en el centro para la pantalla con pie)
		if (p.screen === 'pie') {
			const rx = 0.42; // medio ancho del rebaje
			top(p.topMat, rEdge, xc - half, xc - rx); top(p.topMat, rEdge, xc + rx, xc + half);
			arcToLine(o, E, rKH + 0.05, zBack, xc - rx, xc + rx, 0.785 - T, 0.785, W); // fondo del rebaje, 10 cm por detrás del frontal
			bevel(xc - half, xc - rx); bevel(xc + rx, xc + half);
		} else { top(p.topMat, rEdge, xc - half, xc + half); bevel(xc - half, xc + half); }
		box(o, xc - half, xc + half, zBack + 0.02, zBack, 0.15, y - T, W); // trasera (15 cm libres debajo: Roomba)
	} else if (p.bridge === 'pies') {
		for (const k of [t.khL, t.khR]) {
			top(p.topMat, rEdge, k[0] - 0.13, k[0] + 0.13); bevel(k[0] - 0.13, k[0] + 0.13);
			box(o, k[0] - 0.13, k[0] + 0.13, zBack + 0.02, zBack, 0.15, y - T, W);
		}
		if (p.screen === 'pie') arcToLine(o, E, rKH + 0.10, zBack, xc - 0.42, xc + 0.42, 0.785 - T, 0.785, W);
	}
	if (p.front && p.bridge === 'puente') annulus(o, E, rEdge, rEdge + 0.03, -Math.asin(Math.min(1, half / rEdge)) * 180 / Math.PI, Math.asin(Math.min(1, half / rEdge)) * 180 / Math.PI, 0.15, y - T, 'Lana 3 cm', 1.5);
	// laterales (en ala, simplificados: un tablero vertical a cada lado)
	if (p.bridge !== 'ninguno') for (const x of [xc - half, xc + half - 0.038]) box(o, x, x + 0.038, E[2] - 0.40, zBack, 0, y - T, W);
	if (p.shelf) {
		const s = p.shelf, tk = Math.tan(((s.tilt ?? 0) * Math.PI) / 180);
		const yT = (r: number) => s.y + (r - (s.r0 + s.r1) / 2) * tk;
		const sec = (r0: number, r1: number, a0: number, a1: number, dyTop: number, th: number, mat: string) => sector(o, E, r0, r1, a0, a1, (r) => yT(r) + dyTop, th, mat);
		if (!s.win) sec(s.r0, s.r1, -s.a, s.a, 0, T, W);
		else {
			const w = s.win;
			sec(s.r0, w.r0, -s.a, s.a, 0, T, W); sec(w.r1, s.r1, -s.a, s.a, 0, T, W);
			sec(w.r0, w.r1, -s.a, -w.a, 0, T, W); sec(w.r0, w.r1, w.a, s.a, 0, T, W);
			if (w.fins) {
				sec(w.r0, w.r1, -w.a, w.a, -0.005, 0.026, w.mat); // lana, 5 mm por debajo de los cantos
				for (let r = w.r0 + w.fins.pitch / 2; r + w.fins.t < w.r1; r += w.fins.pitch) sec(r, r + w.fins.t, -w.a, w.a, 0, 0.031, W);
			} else sec(w.r0, w.r1, -w.a, w.a, 0, 0.031, w.mat);
			sec(w.r0, w.r1, -w.a, w.a, -0.031, 0.003, W);
		}
	}
	if (p.sub) box(o, p.sub[0] - 0.15, p.sub[0] + 0.15, p.sub[1] + 0.165, p.sub[1] - 0.165, 0, 0.30, W);
	if (p.slats && p.bridge === 'puente') {
		// listones verticales de 2 cm cada 3,5 cm sobre tela negra, de 15 cm del suelo hasta el puente
		const r = rEdge + p.slats, lim = Math.asin(Math.min(1, (half - 0.05) / r)) * 180 / Math.PI;
		annulus(o, E, r + 0.02, r + 0.04, -lim, lim, 0.15, y - T, 'Lana 3 cm', 1.5);
		for (let a = -lim; a < lim; a += (0.035 / r) * 180 / Math.PI) annulus(o, E, r, r + 0.02, a, a + (0.02 / r) * 180 / Math.PI, 0.15, y - T, W, 5);
	}
	if (p.inst && p.shelf) {
		const sh = p.shelf, tk = Math.tan(((sh.tilt ?? 0) * Math.PI) / 180), c = (sh.r0 + sh.r1) / 2;
		const yT = (r: number) => sh.y + (r - c) * tk;
		if (p.inst === 'teclado') sector(o, E, sh.r0 + 0.05, sh.r0 + 0.33, -21, 21, (r) => yT(r) + 0.09, 0.09, 'Plástico duro', 3);
		else sector(o, E, sh.r0 + 0.05, sh.r0 + 0.33, 28, 44, (r) => yT(r) + 0.05, 0.05, 'Plástico duro', 4);
	}
	if (p.floor) box(o, xc - 0.9, xc + 0.9, E[2] + 0.2, zBack, 0.001, 0.008, p.floor); // moqueta bajo la mesa
	if (p.tray) { box(o, xc - (p.trayW ?? 0.875), xc + (p.trayW ?? 0.875), E[2] - 0.23, E[2] - (p.trayDepth ?? 0.55), 0.63, 0.65, W); if (p.trayMat) box(o, xc - 0.45, xc + 0.45, E[2] - 0.24, E[2] - (p.trayDepth ?? 0.55) + 0.01, 0.65, 0.654, p.trayMat); }
	return o;
}

it('agudos', async () => {
	const s = await loadScene();
	const A = alphaTable(s, EXTRA);
	const T0 = JSON.parse(process.env.TRI ?? '{"E":[2.06,1.1,-4.372],"D":1.37}');
	const t = triangle(T0.E, T0.D);
	const src = sources(t);
	const E = t.E;
	const ears: V3[] = [E, [E[0] - 0.1, E[1], E[2]], [E[0], E[1], E[2] - 0.1], [E[0], E[1], E[2] + 0.1], [E[0], E[1] + 0.05, E[2]], [E[0], E[1] - 0.05, E[2]]];
	const sd = (r: number[], lo: number, hi: number) => { const v = r.filter((_, i) => FREQS[i] >= lo && FREQS[i] <= hi); const m = v.reduce((a, b) => a + b, 0) / v.length; return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length); };
	const noUser = (m: string) => m !== 'Madera DM' && m !== 'Pantalla del ordenador';
	const screenOf = (p: P | null) => {
		// pantalla del modelo (pie a 0,821; panel de 0,926 a 1,346, frontal en z −5,211): centrada en x,
		// con el frontal del panel 6 cm por detrás del de los KH
		const all = assemble(s, (m) => m === 'Pantalla del ordenador', []);
		const zKH = (t.khL[2] + t.khR[2]) / 2;
		const baseY = !p || p.screen === 'colgada' ? 1.10 - 0.315 : 0.785;
		let pos = moveScreen(all.pos, all.mats, [E[0] - 2.057, baseY - 0.821, zKH - 0.06 - -5.211], 0, [2.057, 0.821, -5.375]);
		const P2: number[] = [], M2: string[] = [];
		for (let k = 0; k < all.mats.length; k++) {
			const ys = [1, 4, 7].map((j) => pos[k * 9 + j]);
			if (p?.screen === 'colgada' && Math.max(...ys) < baseY + 0.1) continue; // sin pie
			for (let j = 0; j < 9; j++) P2.push(pos[k * 9 + j]);
			M2.push(all.mats[k]);
		}
		return { positions: P2, materials: M2 };
	};
	const cab = g(); cabinets(cab, t);
	/** la mesa «Arco» de gen_mesas.mjs tal cual (SketchUp → app), con otro ancho si hace falta */
	const real = (half: number, keep: (n: string) => boolean) => {
		const out = g();
		for (const gg of collect((G: any) => mesaArco(G, { ...ARCO, half })) as { name: string; mat: string; finish?: string; tris: number[][] }[]) {
			if (!keep(gg.name) || gg.finish === 'led' || gg.finish === 'telafina') continue;
			const mat = gg.mat === 'Lana Roca 80kg_m3' ? 'Lana 3 cm' : gg.mat === 'Metal pie KH' ? 'Madera DM' : gg.mat;
			for (const [x, y, z] of gg.tris) out.positions.push(x, z, -y);
			for (let i = 0; i < gg.tris.length / 3; i++) out.materials.push(mat);
		}
		return out;
	};
	const REAL: Record<string, () => G> = {
		'arco real': () => real(0.96, () => true), 'arco real sin frente': () => real(0.96, (n) => !/^Frente/.test(n)),
		'arco real sin laterales': () => real(0.96, (n) => !/^Frente|^Lateral/.test(n)), 'arco real sin brazos ni guías': () => real(0.96, (n) => !/^Frente|brazo|guía/.test(n)),
		'arco real sin rebaje': () => real(0.96, (n) => !/^Frente|rebaje/.test(n)), 'arco real sin canto ni pies': () => real(0.96, (n) => !/^Frente|canto|Pie adhesivo/.test(n)),
		'arco real ancho 108 sin frente': () => real(1.08, (n) => !/^Frente/.test(n)), 'arco real ancho 115 sin frente': () => real(1.15, (n) => !/^Frente/.test(n))
	};
	const names = (process.env.VARS ?? Object.keys(V).join(',')).split(',');
	const res: any[] = [];
	for (const name of names) {
		const v = REAL[name] ? { screen: 'pie' } : V[name];
		const p = v === 'sin mesa' ? null : ({ ...base, ...v } as P);
		const geo = assemble(s, noUser, [cab, ...(REAL[name] ? [REAL[name]()] : p ? [desk(t, p)] : []), ...(p?.screen === 'ninguna' ? [] : [screenOf(p)])]);
		const acc: Record<string, number[]> = { lo: [], hi: [], all: [], fase: [], lr: [], peine: [], rfz: [] };
		let keep: any = null;
		const inb = (i: number, a: number, b: number) => FREQS[i] >= a && FREQS[i] <= b;
		// fase en exceso (del conjunto respecto al directo), suavizada a 1/6 oct en complejo: desviación en grados
		const phaseSd = (H: [number, number][]) => {
			const half = 2 ** (1 / 12);
			const ph = FREQS.map((f) => { let re = 0, im = 0; for (let j = 0; j < FREQS.length; j++) if (FREQS[j] >= f / half && FREQS[j] <= f * half) (re += H[j][0]), (im += H[j][1]); return (Math.atan2(im, re) * 180) / Math.PI; });
			const v = ph.filter((_, i) => inb(i, 300, 16000)); const m = v.reduce((a, b) => a + b, 0) / v.length;
			return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
		};
		for (const ear of ears) {
			const e = evaluate(geo, A, { ...src, ear }, 3);
			acc.lo.push((sd(e.rL, 300, 3000) + sd(e.rR, 300, 3000)) / 2); acc.hi.push((sd(e.rL, 3000, 16000) + sd(e.rR, 3000, 16000)) / 2); acc.all.push((sd(e.rL, 300, 16000) + sd(e.rR, 300, 16000)) / 2);
			acc.fase.push((phaseSd(e.cL) + phaseSd(e.cR)) / 2);
			acc.lr.push(sd(e.rL.map((v: number, i: number) => v - e.rR[i]), 300, 16000));
			const top = (lo: number, hi: number) => Math.max(-40, ...e.refl.filter((q: any) => q.ms > lo && q.ms <= hi).map((q: any) => q.db));
			acc.peine.push(top(0, 2)); acc.rfz.push(top(0, 20));
			if (ear === E) keep = { rL: e.rL, rR: e.rR, cL: e.cL, cR: e.cR, refl: e.refl.filter((q) => q.ms <= 30 && q.db > -32).map((q) => ({ ms: +q.ms.toFixed(3), db: +q.db.toFixed(1), src: q.p.src, surf: q.surf, soft: !!q.p.soft, pts: q.p.points.slice(1, -1).map((v) => v.map((c) => +c.toFixed(3))), fres: q.p.fres?.map((x) => +x.toFixed(2)) })) };
		}
		const m = (x: number[]) => x.reduce((a, b) => a + b) / x.length;
		const r: any = Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, m(v)]));
		console.log(`${name.padEnd(46)} 0,3–3k ${r.lo.toFixed(2)}  3–16k ${r.hi.toFixed(2)}  todo ${r.all.toFixed(2)} (peor ${Math.max(...acc.all).toFixed(2)})  fase ${r.fase.toFixed(1)}°  L/R ${r.lr.toFixed(2)}  peine<2ms ${r.peine.toFixed(1)}  20ms ${r.rfz.toFixed(1)}`);
		res.push({ name, ...r, worst: Math.max(...acc.all), ...keep });
		writeFileSync(OUT + (process.env.TAG ?? 'agudos') + '.json', JSON.stringify({ f: FREQS, tri: T0, res }));
	}
	expect(res.length).toBeGreaterThan(0);
}, 6 * 3600 * 1000);
