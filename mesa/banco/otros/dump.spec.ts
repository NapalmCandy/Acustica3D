import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSkp } from '../lib/geometry/skp';
import { analyzeScene } from '../lib/geometry/scene';
const F = '/tmp/claude-0/-home-user-Acustica3D/67763e73-2314-5de2-9c39-bfbb4f041583/scratchpad/skp/Estudio_v0.05.skp';
it('dump', async () => {
	const m = await parseSkp(new Uint8Array(readFileSync(F)));
	const s = analyzeScene(m.tris, m.parts, m.triPart);
	console.log('devices', JSON.stringify(s.devices));
	console.log('notes', s.notes.join('\n'));
	const P = s.tris.positions, M = s.tris.materials;
	const by = new Map<string, { lo: number[]; hi: number[]; n: number }>();
	for (let t = 0; t < M.length; t++) {
		const b = by.get(M[t]) ?? { lo: [1e9, 1e9, 1e9], hi: [-1e9, -1e9, -1e9], n: 0 };
		b.n++;
		for (let k = 0; k < 9; k++) { const a = k % 3; b.lo[a] = Math.min(b.lo[a], P[t * 9 + k]); b.hi[a] = Math.max(b.hi[a], P[t * 9 + k]); }
		by.set(M[t], b);
	}
	for (const [n, b] of by) console.log(n.padEnd(45), b.n, b.lo.map((v) => v.toFixed(3)).join(','), '→', b.hi.map((v) => v.toFixed(3)).join(','));
	console.log('objects', s.objects.length, s.objects.map((o) => o.name + ' ' + o.pos.map((v) => v.toFixed(2)) + ' ' + o.size.map((v) => v.toFixed(2))).join('\n'));
	console.log('hints', JSON.stringify(s.libHints));
	expect(1).toBe(1);
}, 60000);
