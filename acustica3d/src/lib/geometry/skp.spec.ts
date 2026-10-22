import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseSkp, isSkp } from './skp';

// ── constructor de un .skp sintético (mismo formato que SketchUp 2021+) ──
const u16 = (v: number) => new Uint8Array([v & 255, v >> 8]);
const u32 = (v: number) => new Uint8Array([v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]);
const cat = (...a: Uint8Array[]) => {
	const out = new Uint8Array(a.reduce((s, x) => s + x.length, 0));
	let p = 0;
	for (const x of a) (out.set(x, p), (p += x.length));
	return out;
};
const utf8 = (s: string) => new TextEncoder().encode(s);
const f64 = (...v: number[]) => new Uint8Array(new Float64Array(v).buffer);
const id = (n: number) => (n < 65536 ? u16(n) : new Uint8Array([n & 255, (n >> 8) & 255, n >> 16]));
const B = (tag: number, ...kids: Uint8Array[]) => {
	const body = cat(...kids);
	return cat(u16(tag), u32(body.length), body);
};
const ent = (eid: number, extra: Uint8Array[] = [], flags = 6) => B(0x07d0, B(0x05dc, B(0x05de, id(eid))), B(0x07d3, new Uint8Array([flags])), ...extra);

/** Caja de w×h×d pulgadas (6 caras, 12 aristas, 8 vértices) con ids a partir de base. */
function box(base: number, w: number, h: number, d: number, mat?: number) {
	const P = [[0, 0, 0], [w, 0, 0], [w, h, 0], [0, h, 0], [0, 0, d], [w, 0, d], [w, h, d], [0, h, d]];
	const verts = P.map((p, i) => B(0x09c4, B(0x05dc, B(0x05de, id(base + i))), B(0x09c5, f64(...p))));
	const E: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
	const edges = E.map(([a, b], i) => B(0x0bb8, ent(base + 100 + i), B(0x0bb9, id(base + a)), B(0x0bba, id(base + b))));
	const F: [number[], number[]][] = [
		[[0, 1, 2, 3], [0, 0, -1, 0]], [[4, 5, 6, 7], [0, 0, 1, -d]], [[0, 9, 4, 8], [0, -1, 0, 0]],
		[[1, 10, 5, 9], [1, 0, 0, -w]], [[2, 11, 6, 10], [0, 1, 0, -h]], [[3, 8, 7, 11], [-1, 0, 0, 0]]
	];
	const faces = F.map(([es, pl], i) =>
		B(0x0dac, ent(base + 200 + i, mat ? [B(0x07d1, id(mat))] : []), B(0x0dad, f64(...pl)),
			B(0x0dae, B(0x1194, B(0x1195, ...es.map((e) => B(0x0fa0, B(0x0fa1, id(base + 100 + e)), B(0x0fa2, new Uint8Array([0]))))))))
	);
	return [B(0x1389, ...verts), B(0x138a, ...edges), B(0x138b, ...faces)];
}

/** ZIP sin comprimir (método 0) */
function zip(files: [string, Uint8Array][]) {
	const locals: Uint8Array[] = [], central: Uint8Array[] = [];
	let off = 0;
	for (const [name, data] of files) {
		const n = utf8(name);
		const lh = cat(u32(0x04034b50), u16(20), u16(0x0800), u16(0), u32(0), u32(0), u32(data.length), u32(data.length), u16(n.length), u16(0), n, data);
		central.push(cat(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u32(0), u32(0), u32(data.length), u32(data.length), u16(n.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(off), n));
		locals.push(lh);
		off += lh.length;
	}
	const cd = cat(...central);
	return cat(...locals, cd, u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cd.length), u32(off), u16(0));
}

function syntheticSkp() {
	const utf16 = (s: string) => new Uint8Array(new Uint16Array([...s].map((c) => c.charCodeAt(0))).buffer);
	const header = cat(new Uint8Array([0xff, 0xfe, 0xff, 14]), utf16('SketchUp Model'), new Uint8Array([0xff, 0xfe, 0xff, 10]), utf16('{24.0.553}'), utf8('VFF'), new Uint8Array(10));
	const materials = B(0x01f7, B(0x30d4, B(0x30d5,
		B(0x32c8, B(0x05dc, B(0x05de, id(900))), B(0x32cc, utf8('Pladur')), B(0x32ce, B(0x2134, utf8('materials/Pladur/thumbnail.jpg')))),
		B(0x32c8, B(0x05dc, B(0x05de, id(901))), B(0x32cc, utf8('Mueble')), B(0x32ce, B(0x2134, utf8('materials/Mueble/thumbnail.jpg')))),
		B(0x32c8, B(0x05dc, B(0x05de, id(902))), B(0x32cc, utf8('Girada')), B(0x32ce, B(0x2134, utf8('materials/Girada/thumbnail.jpg'))))
	)));
	const layers = B(0x01f8, B(0x3a98, B(0x3a99,
		B(0x3c8c, B(0x05dc, B(0x05de, id(950))), B(0x3c8d, utf8('Layer0')), B(0x3c8e, new Uint8Array([0]))),
		B(0x3c8c, B(0x05dc, B(0x05de, id(951))), B(0x3c8d, utf8('Personas')), B(0x3c8e, new Uint8Array([1])))
	)));
	// definición "Mesa": caja de 40×20×30 pulgadas, sin material (hereda el de la instancia)
	const mesa = B(0x157c, B(0x1388, ent(70000), ...box(70001, 40, 20, 30)), B(0x157e, utf8('Mesa')));
	const defs = B(0x01f9, B(0x1770, B(0x1771, mesa)));
	// raíz: sala de 200×150×100 pulgadas en pladur + 2 mesas (una trasladada y escalada ×2 con w = 0,5,
	// otra en una etiqueta oculta)
	const xf = (tx: number, w: number) => B(0x1966, f64(1, 0, 0, 0, 1, 0, 0, 0, 1, tx, 0, 0, w));
	const inst = (eid: number, extra: Uint8Array[], t: Uint8Array) => B(0x1964, ent(eid, extra), B(0x1965), t, B(0x1967, id(70000)));
	const rootEnts = B(0x01f6, B(0x1388, ent(1), ...box(10, 200, 150, 100, 900),
		B(0x138c, inst(80000, [B(0x07d1, id(901))], xf(50, 0.5)), inst(80001, [B(0x07d2, id(951))], xf(0, 1)),
			// girada +90° alrededor de Z (matriz por filas) y llevada a Y = 300": x local → +Y
			inst(80002, [B(0x07d1, id(902))], B(0x1966, f64(0, -1, 0, 1, 0, 0, 0, 0, 1, 0, 300, 0, 1))))));
	const model = cat(new Uint8Array(16), materials, layers, defs, rootEnts);
	const xml = (name: string, r: number) => utf8(`<mat:material name="${name}" type="0" colorRed="${r}" colorGreen="128" colorBlue="64" />`);
	return cat(header, zip([['model.dat', model], ['materials/Pladur/material.xml', xml('Pladur', 200)], ['materials/Mueble/material.xml', xml('Mueble', 10)]]));
}

describe('importador .skp', () => {
	it('lee un .skp sintético: caras, materiales, componentes, transformaciones y etiquetas ocultas', async () => {
		const m = await parseSkp(syntheticSkp());
		expect(m.version).toBe('24.0.553');
		// sala (6 caras) + 2 mesas visibles (6 caras cada una); la mesa de la etiqueta oculta no
		expect(m.stats.faces).toBe(18);
		expect(m.stats.triangles).toBe(36);
		expect(m.stats.hiddenSkipped).toBe(1);
		expect(m.colors.get('Pladur')).toBe('#c88040');
		const mats = new Set(m.tris.materials);
		expect(mats).toEqual(new Set(['Pladur', 'Mueble', 'Girada'])); // cada mesa hereda el material de su instancia
		// unidades y ejes (la sala): X = X, Y(escena) = Z(SketchUp), Z(escena) = −Y(SketchUp), en metros
		const P = m.tris.positions;
		const xs: number[] = [], ys: number[] = [], zs: number[] = [];
		m.tris.materials.forEach((mm, t) => {
			if (mm === 'Pladur') for (let k = 0; k < 3; k++) (xs.push(P[t * 9 + k * 3]), ys.push(P[t * 9 + k * 3 + 1]), zs.push(P[t * 9 + k * 3 + 2]));
		});
		expect(Math.max(...xs)).toBeCloseTo(200 * 0.0254, 6);
		expect(Math.max(...ys)).toBeCloseTo(100 * 0.0254, 6);
		expect(Math.min(...zs)).toBeCloseTo(-150 * 0.0254, 6);
		// mesa: trasladada 50" y escalada ×2 (w = 0,5) → x de (50/0,5) a (50 + 40)/0,5 pulgadas
		const mesaX: number[] = [];
		m.tris.materials.forEach((mm, t) => { if (mm === 'Mueble') for (let k = 0; k < 3; k++) mesaX.push(P[t * 9 + k * 3]); });
		expect(Math.min(...mesaX)).toBeCloseTo(100 * 0.0254, 6);
		expect(Math.max(...mesaX)).toBeCloseTo(180 * 0.0254, 6);
		// mesa girada 90°: su lado de 40" (eje x local) queda a lo largo de Y de SketchUp (−z en la escena)
		const rx: number[] = [], rz: number[] = [];
		m.tris.materials.forEach((mm, t) => { if (mm === 'Girada') for (let k = 0; k < 3; k++) (rx.push(P[t * 9 + k * 3]), rz.push(P[t * 9 + k * 3 + 2])); });
		expect(Math.min(...rx)).toBeCloseTo(-20 * 0.0254, 6);
		expect(Math.max(...rx)).toBeCloseTo(0, 6);
		expect(Math.min(...rz)).toBeCloseTo(-340 * 0.0254, 6);
		expect(Math.max(...rz)).toBeCloseTo(-300 * 0.0254, 6);
	});

	it('reconoce la cabecera y rechaza otros archivos', async () => {
		expect(isSkp(syntheticSkp())).toBe(true);
		await expect(parseSkp(utf8('no soy un skp'))).rejects.toThrow();
	});

	// archivo real de SketchUp, solo si está en el equipo (no se sube al repositorio)
	const real = process.env.SKP_FILE;
	it.skipIf(!real || !existsSync(real))('lee un .skp real de SketchUp 2024', async () => {
		const m = await parseSkp(new Uint8Array(readFileSync(real!)));
		console.log('versión', m.version, m.stats, m.warnings, [...new Set(m.tris.materials)].slice(0, 12), m.colors.size);
		const P = m.tris.positions;
		const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
		for (let i = 0; i < P.length; i++) { lo[i % 3] = Math.min(lo[i % 3], P[i]); hi[i % 3] = Math.max(hi[i % 3], P[i]); }
		console.log('caja (m)', lo.map((v) => v.toFixed(2)), hi.map((v) => v.toFixed(2)));
		expect(m.stats.triangles).toBeGreaterThan(100);
	});
});
