import { it, expect, beforeAll } from 'vitest';
import { demoRoom, DEMO_POSITIONS } from '../lib/sim/testgeo';
import { objectTris, objectMaterialName, type RoomObject } from '../lib/geometry/objects';
import { DEFAULT_WEIGHTS } from '../lib/analysis/score';
import { LIBRARY, materialAlpha } from '../lib/acoustics/materials';
import type { V3 } from '../lib/sim/voxel';

const msgs: any[] = [];
(globalThis as any).self = { postMessage: (m: any) => msgs.push(m), addEventListener: () => {} };

const lana = LIBRARY.find((l) => l.id === 'panel_lana_roca')!;
function request(extra: Record<string, unknown> = {}) {
	const room = demoRoom();
	const objs: RoomObject[] = [
		{ id: 't1', name: 'Trampa de esquina 1', libId: 'panel_lana_roca', porous: { thickness_mm: 130, density_kgm3: 80, airgap_mm: 0 }, size: [0.55, 1.3, 0.13], pos: [0.2, 0.65, 3.4], rotY: 45 },
		{ id: 'p1', name: 'Panel 1', libId: 'panel_lana_roca', porous: { thickness_mm: 100, density_kgm3: 80, airgap_mm: 50 }, size: [1, 0.6, 0.1], pos: [0.1, 1.2, 1.2], rotY: 90 }
	];
	const names = [...new Set(room.materials), ...objs.map(objectMaterialName)];
	const pos = [...room.positions], mats = [...room.materials];
	for (const o of objs) { const t = objectTris(o); pos.push(...t.positions); for (const _ of t.materials) mats.push(objectMaterialName(o)); }
	const al = (n: string) => { const a = n.startsWith('◆') ? materialAlpha({ ...lana, porous: { thickness_mm: 100, density_kgm3: 80, airgap_mm: 0 } }) : [0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05]; return [...a, a[7]]; };
	const freqs: number[] = [];
	for (let f = 40; f <= 200; f *= 2 ** (1 / 12)) freqs.push(f);
	const P = DEMO_POSITIONS;
	return {
		type: 'optimize', tris: Float32Array.from(pos), triMat: Int32Array.from(mats.map((m) => names.indexOf(m))), betaByMat: names.map((n) => (n.startsWith('◆') ? 0.5 : 0.03)), seed: [P.listener],
		fmax: 150, ppw: 6, durationS: 0.6, engine: 'cpu', tLate: 0.12, listenerY: 1.2, khY: 1.2, subY: 0.2, subEnabled: true,
		freqs, start: { xoverHz: 80, gainDb: 0, invert: false, hpf85: false, bassDb: 0, lowMidDb: 0 }, tune: ['invert', 'xoverHz', 'gainDb', 'hpf85'], subDelayMs: 0,
		weights: { ...DEFAULT_WEIGHTS }, distances: [1.0, 1.1, 1.2], apertures: [50, 60], facings: [0, 180], subMaxDist: null, step: 0.6, method: 'bayes',
		bayes: { base: 5, perM2: 0, max: 6, timeS: 1 },
		treatment: { nStatic: room.materials.length, objects: objs, objMat: objs.map((o) => names.indexOf(objectMaterialName(o))) },
		current: { listener: P.listener, khL: [1.5, 1.2, 0.5] as V3, khR: [2.7, 1.2, 0.5] as V3, sub: P.sub },
		ultra: true, hf: { weight: 1.5, alpha: names.map(al) }, ...extra
	};
}
const until = async (pred: () => boolean, ms = 900000) => { const t0 = Date.now(); while (!pred()) { if (Date.now() - t0 > ms) throw new Error('tiempo'); await new Promise((r) => setTimeout(r, 50)); } };

beforeAll(async () => {
	await import('../lib/sim/sim.worker');
});

it('ULTRA entero', async () => {
	const t0 = Date.now();
	(globalThis as any).self.onmessage({ data: request() });
	await until(() => msgs.some((m) => m.type === 'opt-done' || m.type === 'error'));
	const err = msgs.find((m) => m.type === 'error');
	if (err) console.log(err.message);
	const done = msgs.find((m) => m.type === 'opt-done');
	const phases = [...new Set(msgs.filter((m) => m.type === 'opt-step').map((m) => m.phase))];
	console.log('fases:\n ' + phases.join('\n '));
	console.log('tiempo', ((Date.now() - t0) / 1000).toFixed(0), 's, sims', done.sims, 'log', done.log);
	console.log('top', done.top.map((c: any) => `${c.score.toFixed(1)} refl ${c.parts.reflexiones?.toFixed(2)}`).join(' | '), ' tú', done.current?.score.toFixed(1), done.current?.parts.reflexiones);
	expect(done.top[0].parts.reflexiones).toBeDefined();
	expect(phases.some((p: string) => p.includes('rejilla más fina'))).toBe(true);
	expect(phases.some((p: string) => p.includes('medios y agudos'))).toBe(true);
}, 1800000);

it('ULTRA parado a mitad: termina con lo que tiene', async () => {
	msgs.length = 0;
	(globalThis as any).self.onmessage({ data: request({ bayes: { base: 5, perM2: 0, max: 40, timeS: 600 } }) });
	await until(() => msgs.filter((m) => m.type === 'opt-step').length > 30);
	(globalThis as any).self.onmessage({ data: { type: 'opt-stop' } });
	const t = Date.now();
	await until(() => msgs.some((m) => m.type === 'opt-done' || m.type === 'error'));
	const done = msgs.find((m) => m.type === 'opt-done');
	if (!done) console.log(msgs.find((m) => m.type === 'error')?.message);
	console.log('parado en', ((Date.now() - t) / 1000).toFixed(1), 's; top', done.top.length, done.top[0]?.score.toFixed(1));
	expect(done.top.length).toBeGreaterThan(0);
}, 1800000);
