import { it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { loadScene, alphaTable, assemble, evaluate, FREQS } from './hfeval';
import { EXTRA, moveScreen } from './desk';
import { prism } from './prism';
import { g as newG, extrude } from './desk3';
// @ts-ignore (módulo JS del repositorio)
import { collect, mesaUtil, mesaUtilDiseno } from '../../../mesa/gen_mesas.mjs';
import type { V3 } from '../lib/sim/voxel';
const PL = 'Plástico duro';
EXTRA[PL] = [0.02, 0.03, 0.03, 0.03, 0.03, 0.03, 0.02, 0.02];
EXTRA['Metal pie KH'] = [0.01, 0.01, 0.01, 0.02, 0.02, 0.02, 0.02, 0.02];
import { porousSurfaceImpedance, randomIncidenceAlpha, OCTAVES, LIBRARY, materialAlpha } from '../lib/acoustics/materials';
/** tablero de DM de grosor t con agujeros de diámetro d (parte abierta σ) y lana de roca de 80 kg/m³ detrás
 *  (y dentro): en medios, masa del aire de los agujeros con la corrección de Fok (con muchos agujeros
 *  juntos cada uno añade menos masa); en agudos, cuando el agujero es grande frente a la longitud de onda,
 *  la lana solo absorbe por los agujeros y la madera entre ellos refleja */
function holedAlpha(d: number, t: number, sig: number, woolMm: number): number[] {
	const rho = 1.204, c0 = 343, eta = 1.8e-5;
	const wool = materialAlpha({ ...LIBRARY.find((l) => l.id === 'panel_lana_roca')!, porous: { thickness_mm: woolMm, density_kgm3: 80, airgap_mm: 0 } });
	return OCTAVES.map((f, i) => {
		const w = 2 * Math.PI * f;
		const z = porousSurfaceImpedance(f, { thickness_mm: woolMm, density_kgm3: 80, airgap_mm: 0 });
		const kk = (d / 2) * Math.sqrt((w * rho) / eta);
		const r = ((8 * eta * t) / (sig * rho * c0 * (d / 2) ** 2)) * Math.sqrt(1 + kk * kk / 32);
		const fok = Math.max(0.05, 1 - 1.47 * Math.sqrt(sig) + 0.47 * sig ** 1.5);
		const x = (w * (t + 0.85 * d * fok)) / (sig * c0);
		const lumped = randomIncidenceAlpha({ re: z.re + r, im: z.im + x });
		const geo = sig * wool[i];
		const kd = (w / c0) * d, b = Math.min(1, Math.max(0, (kd - 1) / 1)); // de 1 a 2: del modelo de masa al geométrico
		return lumped * (1 - b) + geo * b;
	});
}
const OUT = '/tmp/claude-0/-home-user-Acustica3D/67763e73-2314-5de2-9c39-bfbb4f041583/scratchpad/';
it('modelo', async () => {
	const s = await loadScene();
	const A = alphaTable(s, EXTRA);
	const Y = 1.1;
	const kh = { khL: [1.376, Y, -5.673] as V3, khR: [2.743, Y, -5.672] as V3 };
	const E: V3 = [2.06, Y, -4.167];
	const ears: V3[] = [E, [E[0] - 0.1, Y, E[2]], [E[0], Y, E[2] - 0.1], [E[0], Y, E[2] + 0.1], [E[0], Y + 0.05, E[2]], [E[0], Y - 0.05, E[2]]];
	/** piezas de gen_mesas.mjs (coordenadas de SketchUp) a la app */
	const fromGen = (build: unknown, remap: Record<string, string> = {}, keep: (name: string) => boolean = () => true) => {
		const out = { positions: [] as number[], materials: [] as string[] };
		for (const g of collect(build) as { name: string; mat: string; tris: number[][] }[]) {
			if (!keep(g.name)) continue;
			for (const [x, y, z] of g.tris) out.positions.push(x, z, -y);
			for (let i = 0; i < g.tris.length / 3; i++) out.materials.push(remap[g.mat] ?? g.mat);
		}
		return out;
	};
	const inst = (kind: 'teclado' | 'pad') => {
		const out: any = { positions: [], materials: [] };
		if (kind === 'teclado') prism(out, 2.06 - 0.475, 2.06 + 0.475, -4.67, -4.95, 0.76, 0.76, 0.85, 0.85, PL);
		else prism(out, 2.78 - 0.15, 2.78 + 0.15, -4.67, -4.97, 0.76, 0.76, 0.81, 0.81, PL);
		return out;
	};
	const curves: Record<string, number[][]> = {}, refls: Record<string, { ms: number; db: number; src: string; surf: string }[]> = {};
	const rows: string[] = [];
	const run = (label: string, mk: () => { pos: number[]; mats: string[] }) => {
		const sds: number[] = [], ers: number[] = [];
		let n = 0;
		for (const ear of ears) {
			const e = evaluate(mk() as any, A, { ...kh, ear }, 3);
			sds.push(e.sd); n += e.early.length;
			ers.push(10 * Math.log10(e.refl.filter((q) => q.ms <= 20).reduce((a, q) => a + 10 ** (q.db / 10), 0) / 2));
			if (ear === E) { curves[label] = [e.rL, e.rR]; refls[label] = e.refl.filter((q) => q.ms <= 60).map((q) => ({ ms: q.ms, db: q.db, src: q.p.src, surf: q.surf })); }
		}
		const m = (v: number[]) => v.reduce((a, b) => a + b) / v.length;
		const row = `${label.padEnd(52)} media ${m(sds).toFixed(2)} (${Math.min(...sds).toFixed(2)}–${Math.max(...sds).toFixed(2)}) tempranas ${(n / 6).toFixed(1)} ER20 ${m(ers).toFixed(1)}`;
		console.log(row);
		rows.push(JSON.stringify({ label, mean: m(sds), min: Math.min(...sds), max: Math.max(...sds), early: n / 6, er20: m(ers) }));
	};
	const noDesk = (m: string) => m !== 'Madera DM';
	const scrUtil = (g: any) => ((g.pos = moveScreen(g.pos, g.mats, [0, 0.94 - 0.821, -5.75 + 5.375], 0, [2.06, 0.821, -5.375])), g);
	const scrDis = (g: any) => ((g.pos = moveScreen(g.pos, g.mats, [0, 0.8 - 0.821, -5.75 + 5.375], 0, [2.06, 0.821, -5.375])), g);
	const R = 'Retícula sobre lana';
	EXTRA[R] = holedAlpha(0.054, 0.019, 0.81, 31);
	/** la pantalla colgada de la aleta (borde de abajo a 0,95 m) y sin su pie */
	let drop = 0; // cuánto se baja la pantalla (recorte en el puente)
	const hang = (g: { pos: number[]; mats: string[] }) => {
		g.pos = moveScreen(g.pos, g.mats, [0, 0.95 - 0.926 - drop, -5.75 + 5.375], 0, [2.06, 0.821, -5.375]);
		const pos: number[] = [], mats: string[] = [];
		for (let t = 0; t < g.mats.length; t++) {
			const ys = [1, 4, 7].map((k) => g.pos[t * 9 + k]);
			if (g.mats[t] === 'Pantalla del ordenador' && Math.max(...ys) < 0.948 - drop) continue;
			for (let k = 0; k < 9; k++) pos.push(g.pos[t * 9 + k]);
			mats.push(g.mats[t]);
		}
		return { pos, mats };
	};
	// la retícula y la lana de la balda cuentan como «retícula sobre lana» (los listones van dentro)
	const final = (extra: any[] = []) => () => hang(assemble(s, noDesk, [fromGen(mesaUtilDiseno, {}, (n: string) => !/retícula|lana bajo/.test(n)), fromGen(mesaUtilDiseno, { 'Lana Roca 80kg_m3': R }, (n: string) => /lana bajo/.test(n)), ...extra]));
	// el puente con un recorte en el centro (detrás) para que baje la pantalla
	const cut = () => { const o: any = { positions: [], materials: [] };
		prism(o, 1.15, 2.96, -5.55, -5.68, 0.92, 0.92, 0.94, 0.94, 'Madera DM');
		prism(o, 1.15, 1.62, -5.68, -5.95, 0.92, 0.92, 0.94, 0.94, 'Madera DM');
		prism(o, 2.5, 2.96, -5.68, -5.95, 0.92, 0.92, 0.94, 0.94, 'Madera DM');
		return o; };
	const finalCut = (extra: any[] = []) => () => hang(assemble(s, noDesk, [fromGen(mesaUtilDiseno, {}, (n: string) => !/retícula|lana bajo|Puente - tablero/.test(n)), fromGen(mesaUtilDiseno, { 'Lana Roca 80kg_m3': R }, (n: string) => /lana bajo/.test(n)), cut(), ...extra]));
	drop = 0.06;
	EXTRA['Caja KH'] = [0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02];
	EXTRA['Frente KH'] = [0.999, 0.999, 0.999, 0.999, 0.999, 0.999, 0.999, 0.999];
	const sd = (r: number[], lo: number, hi: number) => { const v = r.filter((_, i) => FREQS[i] >= lo && FREQS[i] <= hi); const m = v.reduce((a, b) => a + b, 0) / v.length; return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length); };
	// modelo corregido: fuente 1,5 cm delante del frontal (Y 5,558 en SketchUp), caja que tapa
	const front = -5.558, off = 0.015;
	const khF = { khL: [1.376, Y, front + off] as V3, khR: [2.743, Y, front + off] as V3 };
	const cab = () => { const o = newG(); for (const x of [1.376, 2.743]) { extrude(o, [[x - 0.091, front], [x + 0.091, front], [x + 0.091, front - 0.23], [x - 0.091, front - 0.23]], Y - 0.17 + 0.007, Y - 0.17 + 0.277, 'Caja KH'); o.materials[o.materials.length - 8] = o.materials[o.materials.length - 7] = 'Frente KH'; } return o; };
	const res: any[] = [];
	const run2 = (label: string, mk: () => { pos: number[]; mats: string[] }, KH: any) => {
		const lo: number[] = [], hi: number[] = [], all: number[] = [];
		for (const ear of ears) {
			const e = evaluate(mk() as any, A, { ...KH, ear }, 3);
			lo.push((sd(e.rL, 300, 3000) + sd(e.rR, 300, 3000)) / 2); hi.push((sd(e.rL, 3000, 16000) + sd(e.rR, 3000, 16000)) / 2); all.push((sd(e.rL, 300, 16000) + sd(e.rR, 300, 16000)) / 2);
			if (ear === E) res.push({ label, rL: e.rL, rR: e.rR, refl: e.refl.filter((q) => q.ms <= 20 && q.db > -30).map((q) => ({ ms: +q.ms.toFixed(3), db: +q.db.toFixed(1), src: q.p.src, surf: q.surf })) });
		}
		const m = (v: number[]) => v.reduce((a, b) => a + b) / v.length;
		console.log(`${label.padEnd(56)} 0,3–3k ${m(lo).toFixed(2)}  3–16k ${m(hi).toFixed(2)}  0,3–16k ${m(all).toFixed(2)}`);
		res.at(-1).lo = m(lo); res.at(-1).hi = m(hi); res.at(-1).all = m(all);
	};
	// quitar los tacos (con la caja, quedan debajo de ella)
	const noPads = (gg: { pos: number[]; mats: string[] }) => { const pos: number[] = [], mats: string[] = []; for (let t = 0; t < gg.mats.length; t++) { if (gg.mats[t] === 'Metal pie KH') continue; for (let k = 0; k < 9; k++) pos.push(gg.pos[t * 9 + k]); mats.push(gg.mats[t]); } return { pos, mats }; };
	const withCab = (mk: () => { pos: number[]; mats: string[] }) => () => { const gg = noPads(mk()); const c = cab(); return { pos: [...gg.pos, ...c.positions], mats: [...gg.mats, ...c.materials] }; };
	run2('M0 sin mesa', () => assemble(s, noDesk, []), kh);
	run2('M0 mesa nueva', final(), kh);
	run2('M1 sin mesa (fuente en el frontal + caja)', withCab(() => assemble(s, noDesk, [])), khF);
	run2('M1 mesa nueva (fuente en el frontal + caja)', withCab(final()), khF);
	writeFileSync(OUT + 'modelo.json', JSON.stringify({ f: FREQS, res }));
	expect(1).toBe(1);
}, 3600000);
