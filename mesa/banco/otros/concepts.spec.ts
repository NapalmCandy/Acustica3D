import { it, expect } from 'vitest';
import { loadScene, alphaTable, assemble, evaluate } from './hfeval';
import { makeDesk, moveScreen, EXTRA, type DeskParams } from './desk';
import type { V3 } from '../lib/sim/voxel';
it('conceptos', async () => {
	const s = await loadScene();
	const A = alphaTable(s, EXTRA);
	const st = { khL: s.devices.khL!, khR: s.devices.khR!, ear: s.devices.listener! };
	const kh = { L: st.khL, R: st.khR, bottom: 0.95 };
	const base: DeskParams = { x0: 1.13, x1: 2.98, top: 0.73, front: -4.62, back: -5.95, kh, khStand: { w: 0.19, d: 0.24, plate: 0.02 } };
	const pads = (p: DeskParams): DeskParams => ({ ...p, pad: { z0: -4.85, z1: -5.2, h: 0.05 } });
	const concepts: [string, DeskParams | null | 'drawn', V3?][] = [
		['A dibujada', 'drawn'],
		['B sin mesa', null],
		['C plana 0,73 + pies KH', base, [0, -0.09, 0]],
		['D C + lana en la mesa', pads(base), [0, -0.09, 0]],
		['E estrecha 35 cm + pies + alfombra', { ...base, back: -4.97, rug: [1.0, 3.2, -5.6, -4.4] }],
		['F estrecha 35 cm + pies', { ...base, back: -4.97 }],
		['G C + alfombra', { ...base, rug: [1.0, 3.2, -5.6, -4.4] }, [0, -0.09, 0]],
		['H plana 0,73 hasta -5,3 + pies', { ...base, back: -5.3 }, [0, -0.09, 0.1]],
	];
	for (const [label, p, scr] of concepts) {
		const geo = assemble(s, (m) => p === 'drawn' || m !== 'Madera DM', p && p !== 'drawn' ? [makeDesk(p)] : []);
		if (scr) geo.pos = moveScreen(geo.pos, geo.mats, scr);
		const e = evaluate(geo, A, st, 3);
		const er = (lo: number, hi: number) => 10 * Math.log10(e.refl.filter((r) => r.ms <= 5).reduce((a, r) => a + 10 ** ((lo === 300 ? r.dbLow : r.db) / 10), 0) / 2 + 1e-9);
		console.log(`${label.padEnd(36)} sd ${e.sd.toFixed(2)} pp ${e.pp.toFixed(1)}  >-20dB/20ms: ${e.early.length}  ER0-5ms 1-8k ${er(1000, 8000).toFixed(1)} dB, 300-1k ${er(300, 1000).toFixed(1)} dB  (${(e.ms / 1000).toFixed(1)} s)`);
		for (const r of e.early.slice(0, 4)) console.log(`     ${r.p.src} ${r.ms.toFixed(1)} ms ${r.db.toFixed(1)} dB (300–1k ${r.dbLow.toFixed(1)}) ${r.surf}`);
	}
	expect(1).toBe(1);
}, 900000);
