// Triángulo de 60° en la sala del usuario (v0.05, sin mesa): colocación automática con el worker de verdad
// (procesador), distancias de 1,0 a 2,0 m (manual de Neumann), KH y oído a 1,10 m.
import { it, expect, beforeAll } from 'vitest';
import { writeFileSync } from 'node:fs';
import { loadScene } from './hfeval';
import { objectTris, objectMaterialName } from '../lib/geometry/objects';
import { LIBRARY, materialAlpha, alphaToBeta, lowFreqAlpha, porousProduct } from '../lib/acoustics/materials';
import { guessMaterial } from '../lib/state.svelte';
import { DEFAULT_WEIGHTS } from '../lib/analysis/score';
import type { V3 } from '../lib/sim/voxel';

const msgs: any[] = [];
(globalThis as any).self = { postMessage: (m: any) => msgs.push(m), addEventListener: () => {} };
beforeAll(async () => { await import('../lib/sim/sim.worker'); });
const until = async (pred: () => boolean, ms: number) => { const t0 = Date.now(); while (!pred()) { if (Date.now() - t0 > ms) throw new Error('tiempo'); await new Promise((r) => setTimeout(r, 200)); } };
const OUT = '/tmp/claude-0/-home-user-Acustica3D/67763e73-2314-5de2-9c39-bfbb4f041583/scratchpad/';

it('triángulo', async () => {
	const s = await loadScene();
	const objs = s.objects;
	const names = [...new Set(s.tris.materials), ...objs.map(objectMaterialName)];
	const pos = [...s.tris.positions], mats = [...s.tris.materials];
	for (const o of objs) { const t = objectTris(o); pos.push(...t.positions); for (const _ of t.materials) mats.push(objectMaterialName(o)); }
	const alphaOf = (n: string) => {
		const o = objs.find((x) => objectMaterialName(x) === n);
		if (o) { const lib = LIBRARY.find((l) => l.id === o.libId)!; return lib.kind === 'porous' ? materialAlpha({ ...lib, porous: o.porous ?? lib.porous }) : materialAlpha(lib); }
		const id = s.libHints[n] ?? guessMaterial(n);
		const lib = LIBRARY.find((l) => l.id === id)!;
		const prod = porousProduct(n);
		return lib.kind === 'porous' ? materialAlpha({ ...lib, porous: { ...lib.porous!, ...(prod ? { density_kgm3: prod.density_kgm3, flowRes: prod.flowRes } : {}) } }) : materialAlpha(lib);
	};
	const ignore = (n: string) => n === 'Madera DM' || (LIBRARY.find((l) => l.id === (s.libHints[n] ?? guessMaterial(n)))?.kind === 'ignore' && !objs.some((o) => objectMaterialName(o) === n));
	const fmax = 250;
	const freqs: number[] = [];
	for (let f = 40; f <= 200 * 1.0001; f *= 2 ** (1 / 24)) freqs.push(f);
	const d = s.devices as Record<string, V3>;
	const H = 1.1;
	const L: V3 = [d.listener[0], H, d.listener[2]], kL: V3 = [d.khL[0], H, d.khL[2]], kR: V3 = [d.khR[0], H, d.khR[2]];
	const distances: number[] = process.env.DIST ? process.env.DIST.split(',').map(Number) : []; if (!distances.length) for (let x = 1.0; x <= 2.0 + 1e-6; x += 0.1) distances.push(Math.round(x * 100) / 100);
	const req = {
		type: 'optimize', tris: Float32Array.from(pos), triMat: Int32Array.from(mats.map((m) => (ignore(m) ? -1 : names.indexOf(m)))),
		betaByMat: names.map((n) => alphaToBeta(lowFreqAlpha(alphaOf(n), fmax))), seed: [L, kL, kR],
		fmax, ppw: 10, durationS: 1.0, engine: 'cpu', tLate: 0.12, listenerY: H, khY: H, subY: d.sub?.[1] ?? 0.2, subEnabled: true,
		freqs, start: { xoverHz: 85, gainDb: 0, invert: false, hpf85: false, bassDb: 0, lowMidDb: 0 }, tune: ['invert', 'xoverHz', 'gainDb', 'hpf85', 'bassDb', 'lowMidDb'], subDelayMs: 0,
		weights: { ...DEFAULT_WEIGHTS }, distances, apertures: [60], facings: [0], ultra: false, hf: null,
		subMaxDist: null, step: 0.3, method: 'bayes', bayes: process.env.DIST ? { base: 18, perM2: 2.4, max: 60, timeS: 240 } : { base: 18, perM2: 2.4, max: 90, timeS: 900 },
		treatment: null,
		current: { listener: L, khL: kL, khR: kR, sub: d.sub ?? [kL[0], 0.2, kL[2]] }
	};
	console.log('dispositivos', JSON.stringify(d));
	const t0 = Date.now();
	(globalThis as any).self.onmessage({ data: req });
	let last = '';
	await until(() => {
		const st = msgs.filter((m) => m.type === 'opt-step').at(-1);
		if (st && st.phase + st.done !== last) { last = st.phase + st.done; if (st.done % 5 === 0) console.log(((Date.now() - t0) / 1000).toFixed(0) + ' s', st.phase, st.done, '/', st.total); }
		return msgs.some((m) => m.type === 'opt-done' || m.type === 'error');
	}, 6 * 3600 * 1000);
	const err = msgs.find((m) => m.type === 'error'); if (err) console.log('ERROR', err.message);
	const done = msgs.find((m) => m.type === 'opt-done');
	const lastStep = msgs.filter((m) => m.type === 'opt-step').at(-1);
	writeFileSync(OUT + (process.env.TAG ?? 'triangulo') + '.json', JSON.stringify({ tested: done.tested ?? lastStep?.tested, top: done.top, current: done.current, currentTuned: done.currentTuned, log: done.log, bounds: done.bounds, layout: done.layout }));
	for (const t of done.top.slice(0, 10)) console.log(JSON.stringify({ score: t.score, listener: t.listener, khL: t.khL, khR: t.khR, sub: t.sub, settings: t.settings, parts: t.parts }));
	console.log('actual', JSON.stringify({ score: done.current?.score, parts: done.current?.parts }));
	expect(done).toBeDefined();
}, 7 * 3600 * 1000);
