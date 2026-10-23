import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSkp } from '../lib/geometry/skp';
import { F } from './hfeval';
it('kh', async () => {
	const m = await parseSkp(new Uint8Array(readFileSync(F)));
	const by = new Map<string, { lo: number[]; hi: number[] }>();
	const P = m.tris.positions;
	for (let t = 0; t < m.tris.materials.length; t++) {
		const n = m.tris.materials[t]; if (!/Neumann|Oyente|eyeBall|Silla/.test(n)) continue;
		const key = n + ' ' + (P[t * 9] < 2.06 ? 'izq' : 'der');
		const b = by.get(key) ?? { lo: [9, 9, 9], hi: [-9, -9, -9] };
		for (let k = 0; k < 9; k++) { const a = k % 3; b.lo[a] = Math.min(b.lo[a], P[t * 9 + k]); b.hi[a] = Math.max(b.hi[a], P[t * 9 + k]); }
		by.set(key, b);
	}
	for (const [n, b] of by) console.log(n.padEnd(30), b.lo.map((v) => v.toFixed(3)).join(','), '→', b.hi.map((v) => v.toFixed(3)).join(','));
	expect(1).toBe(1);
});
