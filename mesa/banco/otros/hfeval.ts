// Banco de pruebas de mesas: carga el v0.05, quita la mesa dibujada y evalúa variantes con el método de la imagen.
import { readFileSync } from 'node:fs';
import { parseSkp } from '../lib/geometry/skp';
import { analyzeScene } from '../lib/geometry/scene';
import { objectTris, objectMaterialName, type RoomObject } from '../lib/geometry/objects';
import { LIBRARY, materialAlpha, porousProduct } from '../lib/acoustics/materials';
import { guessMaterial } from '../lib/state.svelte';
import { findPaths, pathAmplitude, octInterp, C_SOUND, type Path } from '../lib/hf/imageSource';
import type { V3 } from '../lib/sim/voxel';

export const F = '/tmp/claude-0/-home-user-Acustica3D/67763e73-2314-5de2-9c39-bfbb4f041583/scratchpad/skp/Estudio_v0.05.skp';

export interface Geo { positions: number[]; materials: string[] }
export async function loadScene() {
	const m = await parseSkp(new Uint8Array(readFileSync(F)));
	const s = analyzeScene(m.tris, m.parts, m.triPart);
	return s;
}
export type Scene = Awaited<ReturnType<typeof loadScene>>;

/** absorción (9 octavas) de cada material: el de la biblioteca que le pondría la app */
export function alphaTable(s: Scene, extra: Record<string, number[]> = {}) {
	const objByName = new Map(s.objects.map((o) => [objectMaterialName(o), o]));
	return (name: string): number[] | null => {
		if (extra[name]) return [...extra[name], extra[name][extra[name].length - 1]];
		const o = objByName.get(name);
		let a: number[];
		if (o) {
			const lib = LIBRARY.find((l) => l.id === o.libId)!;
			a = lib.kind === 'porous' ? materialAlpha({ ...lib, porous: o.porous ?? lib.porous }) : materialAlpha(lib);
		} else {
			const id = s.libHints[name] ?? guessMaterial(name);
			const lib = LIBRARY.find((l) => l.id === id)!;
			if (lib.kind === 'ignore') return null;
			const prod = porousProduct(name);
			a = lib.kind === 'porous' ? materialAlpha({ ...lib, porous: { ...lib.porous!, ...(prod ? { density_kgm3: prod.density_kgm3, flowRes: prod.flowRes } : {}) } }) : materialAlpha(lib);
		}
		return [...a, a[a.length - 1]];
	};
}

export interface Setup { khL: V3; khR: V3; ear: V3 }

export function assemble(s: Scene, keep: (mat: string, t: number) => boolean, add: Geo[], objects: RoomObject[] = s.objects) {
	const P = s.tris.positions, M = s.tris.materials;
	const pos: number[] = [], mats: string[] = [];
	for (let t = 0; t < M.length; t++) if (keep(M[t], t)) { for (let k = 0; k < 9; k++) pos.push(P[t * 9 + k]); mats.push(M[t]); }
	for (const o of objects) { const t = objectTris(o); pos.push(...t.positions); for (const _ of t.materials) mats.push(objectMaterialName(o)); }
	for (const g of add) { pos.push(...g.positions); mats.push(...g.materials); }
	return { pos, mats };
}

export const FREQS: number[] = [];
for (let f = 200; f <= 20000 * 1.0001; f *= Math.pow(2, 1 / 48)) FREQS.push(f);

export function evaluate(geo: { pos: number[]; mats: string[] }, alphaByName: (n: string) => number[] | null, st: Setup, order = 3, diff = true) {
	const names = [...new Set(geo.mats)];
	const al = names.map((n) => alphaByName(n));
	const triMat = Int32Array.from(geo.mats.map((n) => (al[names.indexOf(n)] ? names.indexOf(n) : -1)));
	const alpha = (m: number) => al[m] ?? [0, 0, 0, 0, 0, 0, 0, 0, 0];
	const aimOf = (id: string): V3 => { const s = id === 'khL' ? st.khL : st.khR; const d = [st.ear[0] - s[0], st.ear[1] - s[1], st.ear[2] - s[2]]; const l = Math.hypot(...d); return [d[0] / l, d[1] / l, d[2] / l]; };
	const t0 = performance.now();
	const paths = findPaths(Float32Array.from(geo.pos), triMat, [{ id: 'khL', pos: st.khL }, { id: 'khR', pos: st.khR }], st.ear, { maxOrder: order, diffraction: diff, prune: { aim: { khL: aimOf('khL'), khR: aimOf('khR') }, alpha: names.map((_, i) => alpha(i)), minDb: -30 } });
	const ms = performance.now() - t0;
	const direct = new Map(paths.filter((p) => p.order === 0).map((p) => [p.src, p]));
	const band = [1000, 2000, 4000, 8000];
	const lvl = (p: Path, b = band) => b.reduce((s, f) => s + pathAmplitude(p, f, aimOf(p.src), alpha) ** 2, 0) / b.length;
	const refl = paths.filter((p) => p.order > 0).map((p) => {
		const d = direct.get(p.src)!;
		return { p, ms: ((p.length - d.length) / C_SOUND) * 1000, db: 10 * Math.log10(lvl(p) / lvl(d)), dbLow: 10 * Math.log10(lvl(p, [300, 500, 700, 1000]) / lvl(d, [300, 500, 700, 1000])), surf: p.mats.map((m) => names[m]).join(' → ') };
	});
	const early = refl.filter((r) => r.ms <= 20 && r.db > -20).sort((a, b) => b.db - a.db);
	// respuesta de cada KH (directo + reflexiones calculadas, sin cola) relativa al directo, 1/6 oct
	const resp = (id: string) => {
		const pw = FREQS.map((f) => {
			let re = 0, im = 0;
			for (const p of paths) { if (p.src !== id) continue; const a = pathAmplitude(p, f, aimOf(id), alpha); const ph = (-2 * Math.PI * f * p.length) / C_SOUND; re += a * Math.cos(ph); im += a * Math.sin(ph); }
			const d = pathAmplitude(direct.get(id)!, f, aimOf(id), alpha);
			return (re * re + im * im) / (d * d);
		});
		const half = Math.pow(2, 1 / 12);
		return FREQS.map((f, i) => { let s = 0, n = 0; for (let j = 0; j < FREQS.length; j++) if (FREQS[j] >= f / half && FREQS[j] <= f * half) (s += pw[j]), n++; return 10 * Math.log10(s / n); });
	};
	// solo las reflexiones de los primeros 20 ms (las que colorean; las tardías se oyen como sala)
	const stats = (r: number[], lo: number, hi: number) => { const v = r.filter((_, i) => FREQS[i] >= lo && FREQS[i] <= hi); const m = v.reduce((a, b) => a + b, 0) / v.length; return { sd: Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length), pp: Math.max(...v) - Math.min(...v) }; };
	const rL = resp('khL'), rR = resp('khR');
	const mL = stats(rL, 300, 4000), mR = stats(rR, 300, 4000);
	return { paths, refl, early, ms, rL, rR, sd: (mL.sd + mR.sd) / 2, pp: (mL.pp + mR.pp) / 2 };
}
