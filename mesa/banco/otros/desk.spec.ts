import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSkp } from '../lib/geometry/skp';
import { analyzeScene } from '../lib/geometry/scene';
const F = '/tmp/claude-0/-home-user-Acustica3D/67763e73-2314-5de2-9c39-bfbb4f041583/scratchpad/skp/Estudio_v0.05.skp';
it('desk', async () => {
	const m = await parseSkp(new Uint8Array(readFileSync(F)));
	// partes con su nombre de la mesa y la pantalla
	const parts = new Map<number, number>();
	for (let t = 0; t < m.tris.materials.length; t++) if (/Madera DM|Monitor|samsung/.test(m.tris.materials[t])) parts.set(m.triPart[t], (parts.get(m.triPart[t]) ?? 0) + 1);
	const chain = (p: number): string => (p < 0 ? '' : chain(m.parts[p].parent) + '/' + m.parts[p].name);
	for (const [p, n] of parts) console.log(n, chain(p));
	const s = analyzeScene(m.tris, m.parts, m.triPart);
	const P = s.tris.positions, M = s.tris.materials;
	for (const mat of ['Madera DM', 'Pantalla del ordenador']) {
		// caras planas agrupadas por normal y distancia
		const g = new Map<string, { a: number; lo: number[]; hi: number[] }>();
		for (let t = 0; t < M.length; t++) {
			if (M[t] !== mat) continue;
			const o = t * 9;
			const e1 = [P[o + 3] - P[o], P[o + 4] - P[o + 1], P[o + 5] - P[o + 2]], e2 = [P[o + 6] - P[o], P[o + 7] - P[o + 1], P[o + 8] - P[o + 2]];
			const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
			const l = Math.hypot(...n); if (l < 1e-9) continue;
			const nn = n.map((v) => v / l);
			const d = nn[0] * P[o] + nn[1] * P[o + 1] + nn[2] * P[o + 2];
			const key = nn.map((v) => v.toFixed(2)).join(',') + ' d=' + d.toFixed(2);
			const b = g.get(key) ?? { a: 0, lo: [9, 9, 9], hi: [-9, -9, -9] };
			b.a += l / 2;
			for (let k = 0; k < 9; k++) { const ax = k % 3; b.lo[ax] = Math.min(b.lo[ax], P[o + k]); b.hi[ax] = Math.max(b.hi[ax], P[o + k]); }
			g.set(key, b);
		}
		console.log('==', mat);
		for (const [k, b] of [...g].sort((a, b) => b[1].a - a[1].a).slice(0, 30)) console.log(k.padEnd(28), b.a.toFixed(3), b.lo.map((v) => v.toFixed(3)).join(','), '→', b.hi.map((v) => v.toFixed(3)).join(','));
	}
	expect(1).toBe(1);
}, 60000);
