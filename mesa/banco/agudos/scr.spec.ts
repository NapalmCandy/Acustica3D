import { it } from 'vitest';
import { loadScene } from './hfeval';
it('pantalla', async () => {
	const s = await loadScene();
	const P = s.tris.positions, M = s.tris.materials;
	const bb: Record<string, number[]> = {};
	for (let t = 0; t < M.length; t++) { const b = (bb[M[t]] ??= [1e9, 1e9, 1e9, -1e9, -1e9, -1e9]); for (let k = 0; k < 3; k++) for (let c = 0; c < 3; c++) { const v = P[t * 9 + k * 3 + c]; b[c] = Math.min(b[c], v); b[c + 3] = Math.max(b[c + 3], v); } }
	for (const [n, b] of Object.entries(bb)) console.log(n.padEnd(60), b.map((v) => v.toFixed(3)).join(' '));
	console.log('objetos', s.objects.length, JSON.stringify(s.devices));
	// la pantalla: alturas de sus triángulos (pie y panel)
	const ys: number[] = []; for (let t = 0; t < M.length; t++) if (/Pantalla/.test(M[t])) ys.push((P[t*9+1]+P[t*9+4]+P[t*9+7])/3);
	ys.sort((a,b)=>a-b); console.log('pantalla y', ys.filter((_, i) => i % Math.ceil(ys.length / 40) === 0).map((v) => v.toFixed(3)).join(' '));
});
