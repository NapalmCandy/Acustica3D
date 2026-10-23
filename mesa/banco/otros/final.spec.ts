import { it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { loadScene, alphaTable, assemble, evaluate, FREQS } from './hfeval';
import { makeDesk, moveScreen, EXTRA, type DeskParams } from './desk';
import type { V3 } from '../lib/sim/voxel';
it('final', async () => {
	const s = await loadScene();
	const A = alphaTable(s, EXTRA);
	const st0 = { khL: s.devices.khL!, khR: s.devices.khR!, ear: s.devices.listener! };
	const kh = { L: st0.khL, R: st0.khR, bottom: 0.95 };
	const N: DeskParams = { x0: 1.13, x1: 2.98, top: 0.73, front: -4.62, back: -5.5, kh, khStand: { w: 0.19, d: 0.24, plate: 0.02 }, pad: { z0: -4.85, z1: -5.15, h: 0.05 } };
	const scrN: V3 = [0, N.top - 0.82, 0.05];
	const cases: [string, (st: typeof st0) => { pos: number[]; mats: string[] }][] = [
		['dibujada', () => assemble(s, () => true, [])],
		['nueva', () => { const g = assemble(s, (m) => m !== 'Madera DM', [makeDesk(N)]); g.pos = moveScreen(g.pos, g.mats, scrN, 8, [2.06, 0.82, -5.37]); return g; }],
		['nueva sin lana', () => { const g = assemble(s, (m) => m !== 'Madera DM', [makeDesk({ ...N, pad: undefined })]); g.pos = moveScreen(g.pos, g.mats, scrN, 8, [2.06, 0.82, -5.37]); return g; }],
		['nueva altura 0,72', () => { const g = assemble(s, (m) => m !== 'Madera DM', [makeDesk({ ...N, top: 0.72 })]); g.pos = moveScreen(g.pos, g.mats, [0, -0.1, 0.05], 8, [2.06, 0.82, -5.37]); return g; }],
	];
	const ears: [string, V3][] = [['oído dibujado', st0.ear], ['centrado', [2.06, st0.ear[1], st0.ear[2]]], ['10 cm adelante', [st0.ear[0], st0.ear[1], st0.ear[2] - 0.1]], ['10 cm atrás', [st0.ear[0], st0.ear[1], st0.ear[2] + 0.1]], ['5 cm más alto', [st0.ear[0], st0.ear[1] + 0.05, st0.ear[2]]], ['5 cm más bajo', [st0.ear[0], st0.ear[1] - 0.05, st0.ear[2]]]];
	const curves: Record<string, number[][]> = {};
	for (const [label, mk] of cases) {
		const res: string[] = [];
		for (const [el, ear] of ears) {
			const st = { ...st0, ear };
			const e = evaluate(mk(st) as any, A, st, 3);
			const er20 = 10 * Math.log10(e.refl.filter((q) => q.ms <= 20).reduce((a, q) => a + 10 ** (q.db / 10), 0) / 2);
			res.push(`${el}: ${e.sd.toFixed(2)}/${e.early.length}/ER20 ${er20.toFixed(1)}`);
			if (el === 'oído dibujado') curves[label] = [e.rL, e.rR];
		}
		console.log(label.padEnd(20), res.join('  '));
	}
	writeFileSync('/tmp/claude-0/-home-user-Acustica3D/67763e73-2314-5de2-9c39-bfbb4f041583/scratchpad/curves.json', JSON.stringify({ f: FREQS, curves }));
	expect(1).toBe(1);
}, 1800000);
