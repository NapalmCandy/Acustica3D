import { it, expect } from 'vitest';
import { loadScene, alphaTable, assemble, evaluate } from './hfeval';
it('base', async () => {
	const s = await loadScene();
	const st = { khL: s.devices.khL!, khR: s.devices.khR!, ear: s.devices.listener! };
	const A = alphaTable(s);
	for (const [label, keep] of [['tal cual', () => true], ['sin mesa', (m: string) => m !== 'Madera DM'], ['sin pantalla', (m: string) => m !== 'Pantalla del ordenador'], ['sin mesa ni pantalla', (m: string) => m !== 'Madera DM' && m !== 'Pantalla del ordenador']] as const) {
		const e = evaluate(assemble(s, keep, []), A, st);
		console.log(`\n== ${label}: ${e.refl.length} refl, ${e.ms.toFixed(0)} ms, sd ${e.sd.toFixed(2)} dB, pp ${e.pp.toFixed(1)} dB, tempranas>-20: ${e.early.length}, soft ${e.paths.filter((p) => p.soft).length}`);
		for (const r of e.early.slice(0, 10)) console.log(`  ${r.p.soft ? "~" : " "}${r.p.src} ${r.ms.toFixed(1)} ms ${r.db.toFixed(1)} dB (300–1k ${r.dbLow.toFixed(1)}) ${r.surf}  @${r.p.points.slice(1, -1).map((q) => q.map((v) => v.toFixed(2)).join(',')).join(' | ')}`);
		const desk = e.refl.filter((r) => /Madera|Pantalla/.test(r.surf) && r.ms < 30).sort((a, b) => b.dbLow - a.dbLow).slice(0, 8);
		for (const r of desk) console.log(`   mesa/pant: ${r.p.src} ${r.ms.toFixed(1)} ms ${r.db.toFixed(1)} dB (300–1k ${r.dbLow.toFixed(1)}) ${r.surf}`);
	}
	expect(1).toBe(1);
}, 300000);
