import { it, expect } from 'vitest';
import { loadScene, alphaTable, assemble, evaluate } from './hfeval';
import { makeDesk, moveScreen, EXTRA, type DeskParams } from './desk';
import type { V3 } from '../lib/sim/voxel';
it('robusto', async () => {
	const s = await loadScene();
	const A = alphaTable(s, EXTRA);
	const st0 = { khL: s.devices.khL!, khR: s.devices.khR!, ear: s.devices.listener! };
	const kh = { L: st0.khL, R: st0.khR, bottom: 0.95 };
	const N: DeskParams = { x0: 1.13, x1: 2.98, top: 0.73, front: -4.62, back: -5.45, kh, khStand: { w: 0.19, d: 0.24, plate: 0.02 }, pad: { z0: -4.9, z1: -5.1, h: 0.05 } };
	const E = st0.ear;
	const ears: V3[] = [E, [2.06, E[1], E[2]], [E[0], E[1], E[2] - 0.1], [E[0], E[1], E[2] + 0.1], [E[0], E[1] + 0.05, E[2]], [E[0], E[1] - 0.05, E[2]]];
	const pads: [number, number, number][] = [[-4.9, -5.1, 0.05], [-4.85, -5.15, 0.05], [-4.8, -5.15, 0.05], [-4.8, -5.2, 0.05], [-4.85, -5.2, 0.05], [-4.8, -5.1, 0.05], [-4.75, -5.15, 0.05], [-4.8, -5.15, 0.08]];
	for (const [z0, z1, h] of pads) {
		const sds: number[] = [];
		let n = 0;
		for (const ear of ears) {
			const st = { ...st0, ear };
			const g = assemble(s, (m) => m !== 'Madera DM', [makeDesk({ ...N, pad: { z0, z1, h } })]);
			g.pos = moveScreen(g.pos, g.mats, [0, N.top - 0.82, 0.1], 8, [2.06, 0.82, -5.37]);
			const e = evaluate(g as any, A, st, 3);
			sds.push(e.sd); n += e.early.length;
		}
		console.log(`lana ${z0}…${z1} (${h * 100} cm, teclado ${((-4.62 - z0) * -100).toFixed(0)} cm)  media ${(sds.reduce((a, b) => a + b) / sds.length).toFixed(2)}  peor ${Math.max(...sds).toFixed(2)}  tempranas ${n}  [${sds.map((v) => v.toFixed(2)).join(' ')}]`);
	}
	expect(1).toBe(1);
}, 3600000);
