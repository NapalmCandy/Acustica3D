// Importador de archivos .skp de SketchUp (versiones 2021 y posteriores).
//
// Formato, deducido analizando archivos .skp (sin usar el SDK de SketchUp):
//   cabecera   FF FE FF <n> "SketchUp Model" (UTF-16) FF FE FF <n> "{24.0.553}" "VFF" …
//   después    un ZIP con model.dat (geometría), materials/<nombre>/material.xml (colores), miniaturas…
//   model.dat  16 bytes de cabecera y luego un árbol de bloques [u16 etiqueta][u32 longitud][contenido].
//              Los números son little-endian; las coordenadas, dobles en pulgadas con Z hacia arriba.
//              Las referencias entre entidades son identificadores enteros (sin signo, 1–4 bytes).
//
// Etiquetas que usamos (el resto se ignora):
//   01f7 → 30d4 → 30d5 → 32c8   material: 05dc/05de id · 32cc nombre · 32ce/2134 ruta en el ZIP
//   01f8 → 3a98 → 3a99 → 3c8c   etiqueta (capa): id · 3c8d nombre · 3c8e oculta (1)
//   01f9 → 1770 → 1771 → 157c   definición de componente o grupo: 1388 entidades · 157e nombre
//   01f6 → 1388                 entidades del modelo (raíz)
//   1388 (entidades)            07d0 id · 1389 vértices · 138a aristas · 138b caras
//                               138c instancias de componentes · 138d grupos (1d4c → 1964)
//   07d0 (común)                05dc/05de id · 07d1 material · 07d2 etiqueta · 07d3 indicadores (bit 0: oculta)
//   09c4 vértice                09c5 posición (3 dobles)
//   0bb8 arista                 0bb9 vértice inicial · 0bba vértice final
//   0dac cara                   0dad plano (a, b, c, d) · 0dae bucles: 1194 → 1195 → 0fa0 (0fa1 arista, 0fa2 sentido)
//                               0daf material de la cara trasera
//   1964 instancia / grupo      1965 nombre · 1966 transformación (matriz 3×3 por filas, origen, w) · 1967 definición
import * as THREE from 'three';
import type { NamedTris } from '../sim/testgeo';

const INCH = 0.0254;

/** Grupo o instancia de componente del dibujo, para reconocer objetos (altavoces, oyente, trampas…). */
export interface SkpPart {
	name: string; // nombre de la instancia o, si no tiene, de su definición
	parent: number; // índice del grupo que lo contiene (−1 = raíz del modelo)
}

export interface SkpModel {
	version: string;
	tris: NamedTris; // metros, Y hacia arriba (como el resto de la app)
	parts: SkpPart[];
	/** grupo más interior de cada triángulo (−1 = suelto en la raíz) */
	triPart: Int32Array;
	colors: Map<string, string>; // material → color #rrggbb
	warnings: string[];
	stats: { faces: number; triangles: number; instances: number; hiddenSkipped: number; definitions: number };
}

interface Node {
	tag: number;
	off: number;
	len: number;
}

/** Lector del árbol de bloques de model.dat. */
class Tree {
	private dv: DataView;
	private dec = new TextDecoder('utf-8');
	constructor(public b: Uint8Array) {
		this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
	}
	kids(n: Node | { off: number; len: number }): Node[] {
		const out: Node[] = [];
		let p = n.off;
		const end = n.off + n.len;
		while (p + 6 <= end) {
			const tag = this.dv.getUint16(p, true);
			const len = this.dv.getUint32(p + 2, true);
			if (p + 6 + len > end) throw new Error('model.dat dañado o de una versión no reconocida.');
			out.push({ tag, off: p + 6, len });
			p += 6 + len;
		}
		return out;
	}
	child(n: Node | undefined, tag: number): Node | undefined {
		if (!n) return undefined;
		for (const k of this.kids(n)) if (k.tag === tag) return k;
		return undefined;
	}
	path(n: Node | undefined, ...tags: number[]): Node | undefined {
		let cur = n;
		for (const t of tags) cur = this.child(cur, t);
		return cur;
	}
	all(n: Node | undefined, tag: number): Node[] {
		return n ? this.kids(n).filter((k) => k.tag === tag) : [];
	}
	uint(n: Node | undefined): number {
		if (!n || n.len === 0 || n.len > 6) return -1;
		let v = 0;
		for (let i = n.len - 1; i >= 0; i--) v = v * 256 + this.b[n.off + i];
		return v;
	}
	byte(n: Node | undefined): number {
		return n && n.len ? this.b[n.off] : 0;
	}
	str(n: Node | undefined): string {
		return n ? this.dec.decode(this.b.subarray(n.off, n.off + n.len)) : '';
	}
	f64(n: Node, i: number): number {
		return this.dv.getFloat64(n.off + 8 * i, true);
	}
	/** id de una entidad: hijo 05dc/05de, directo o dentro de 07d0 */
	id(n: Node): number {
		const direct = this.path(n, 0x05dc, 0x05de);
		return direct ? this.uint(direct) : this.uint(this.path(n, 0x07d0, 0x05dc, 0x05de));
	}
}

// ── ZIP (solo lo necesario: directorio central y "deflate") ──

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
	const ds = new DecompressionStream('deflate-raw');
	const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZip(z: Uint8Array): Promise<Map<string, () => Promise<Uint8Array>>> {
	const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
	let eocd = -1;
	for (let p = z.length - 22; p >= Math.max(0, z.length - 65557); p--)
		if (dv.getUint32(p, true) === 0x06054b50) {
			eocd = p;
			break;
		}
	if (eocd < 0) throw new Error('El contenedor del .skp no es un ZIP válido.');
	const count = dv.getUint16(eocd + 10, true);
	let p = dv.getUint32(eocd + 16, true);
	const dec = new TextDecoder('utf-8');
	const files = new Map<string, () => Promise<Uint8Array>>();
	for (let i = 0; i < count; i++) {
		if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP del .skp dañado.');
		const method = dv.getUint16(p + 10, true);
		const csize = dv.getUint32(p + 20, true);
		const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
		const local = dv.getUint32(p + 42, true);
		const name = dec.decode(z.subarray(p + 46, p + 46 + nlen));
		p += 46 + nlen + xlen + clen;
		const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
		const raw = z.subarray(start, start + csize);
		files.set(name, async () => (method === 0 ? raw : method === 8 ? inflateRaw(raw) : Promise.reject(new Error(`Compresión ${method} no soportada`))));
	}
	return files;
}

// ── geometría ──

/** Transformación de SketchUp (13 dobles: matriz 3×3 por filas, origen, w) como matriz 4×4 homogénea:
 *  p' = (R·p + origen) / w, que es justo lo que hace Vector3.applyMatrix4. Que va por filas se ha
 *  comprobado comparando con la miniatura que guarda el propio .skp (con columnas, las piezas
 *  giradas quedan mal orientadas). */
function skpMatrix(v: number[]): THREE.Matrix4 {
	return new THREE.Matrix4().fromArray([v[0], v[3], v[6], 0, v[1], v[4], v[7], 0, v[2], v[5], v[8], 0, v[9], v[10], v[11], v[12] || 1]);
}

/** Ordena las aristas de un bucle en una cadena de vértices (no depende del indicador de sentido). */
function chainLoop(edges: [number, number][]): number[] | null {
	if (edges.length < 3) return null;
	const [a0, b0] = edges[0];
	const [a1, b1] = edges[1];
	let cur = b0 === a1 || b0 === b1 ? b0 : a0;
	const out = [cur === b0 ? a0 : b0];
	for (let i = 0; i < edges.length; i++) {
		const [a, b] = edges[i];
		if (i > 0) {
			if (a === cur) cur = b;
			else if (b === cur) cur = a;
			else return null;
		}
		if (i < edges.length - 1) out.push(cur);
	}
	return out;
}

export function isSkp(buf: Uint8Array): boolean {
	return buf.length > 32 && buf[0] === 0xff && buf[1] === 0xfe && buf[2] === 0xff && new TextDecoder('utf-16le').decode(buf.subarray(4, 32)).startsWith('SketchUp Model');
}

export async function parseSkp(buf: Uint8Array): Promise<SkpModel> {
	if (!isSkp(buf)) throw new Error('No es un archivo de SketchUp (.skp).');
	const warnings: string[] = [];
	// versión: segunda cadena UTF-16 "{xx.x.xxxx}"
	const n1 = buf[3];
	const vpos = 4 + 2 * n1;
	const vlen = buf[vpos + 3];
	const version = new TextDecoder('utf-16le').decode(buf.subarray(vpos + 4, vpos + 4 + 2 * vlen)).replace(/[{}]/g, '');
	let zipStart = -1;
	for (let p = vpos; p < Math.min(buf.length - 4, 4096); p++)
		if (buf[p] === 0x50 && buf[p + 1] === 0x4b && buf[p + 2] === 0x03 && buf[p + 3] === 0x04) {
			zipStart = p;
			break;
		}
	if (zipStart < 0)
		throw new Error(
			`Este .skp es de SketchUp ${version.split('.')[0]} o anterior, que usa un formato antiguo. Ábrelo en SketchUp 2021 o posterior y guárdalo de nuevo, o expórtalo como .dae.`
		);
	const files = await readZip(buf.subarray(zipStart));
	const md = files.get('model.dat');
	if (!md) throw new Error('El .skp no contiene model.dat.');
	const t = new Tree(await md());
	const root = { off: 16, len: t.b.length - 16 };
	const top = new Map(t.kids(root).map((k) => [k.tag, k] as const));

	// materiales: nombre y color (del material.xml de cada uno)
	const matName = new Map<number, string>();
	const colors = new Map<string, string>();
	for (const m of t.all(t.path(top.get(0x01f7), 0x30d4, 0x30d5), 0x32c8)) {
		const name = t.str(t.child(m, 0x32cc)) || 'sin_nombre';
		matName.set(t.id(m), name);
		const thumb = t.str(t.path(m, 0x32ce, 0x2134));
		const dir = thumb.includes('/') ? thumb.slice(0, thumb.lastIndexOf('/')) : `materials/${name}`;
		const xml = files.get(`${dir}/material.xml`);
		if (xml) {
			const txt = new TextDecoder().decode(await xml());
			const c = /colorRed="(\d+)"\s+colorGreen="(\d+)"\s+colorBlue="(\d+)"/.exec(txt);
			if (c) colors.set(name, '#' + [c[1], c[2], c[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join(''));
		}
	}
	// etiquetas (capas) ocultas
	const hiddenLayer = new Set<number>();
	const layerName = new Map<number, string>();
	for (const l of t.all(t.path(top.get(0x01f8), 0x3a98, 0x3a99), 0x3c8c)) {
		layerName.set(t.id(l), t.str(t.child(l, 0x3c8d)));
		if (t.byte(t.child(l, 0x3c8e)) === 1) hiddenLayer.add(t.id(l));
	}
	// definiciones (componentes y grupos), por el id de su lista de entidades
	const defs = new Map<number, { ents: Node; name: string }>();
	for (const c of t.all(t.path(top.get(0x01f9), 0x1770, 0x1771), 0x157c)) {
		const ents = t.child(c, 0x1388);
		if (ents) defs.set(t.id(ents), { ents, name: t.str(t.child(c, 0x157e)) });
	}
	const rootEnts = t.child(top.get(0x01f6), 0x1388);
	if (!rootEnts) throw new Error('El .skp no tiene entidades.');

	const out: NamedTris = { positions: [], materials: [] };
	const stats = { faces: 0, triangles: 0, instances: 0, hiddenSkipped: 0, definitions: defs.size };
	const DEFAULT = 'sin_material';
	const cache = new Map<number, { verts: Map<number, [number, number, number]>; edges: Map<number, [number, number]> }>();

	const common = (n: Node) => {
		const e = t.child(n, 0x07d0);
		return {
			mat: t.uint(t.child(e, 0x07d1)),
			layer: t.uint(t.child(e, 0x07d2)),
			hidden: (t.byte(t.child(e, 0x07d3)) & 1) === 1
		};
	};

	const tmp = new THREE.Vector3();
	const parts: SkpPart[] = [];
	const triPart: number[] = [];
	const visit = (ents: Node, xf: THREE.Matrix4, inherited: string, depth: number, part: number) => {
		if (depth > 64) throw new Error('Componentes anidados demasiado profundos (¿referencia circular?).');
		const key = ents.off;
		let topo = cache.get(key);
		if (!topo) {
			const verts = new Map<number, [number, number, number]>();
			for (const v of t.all(t.child(ents, 0x1389), 0x09c4)) {
				const p = t.child(v, 0x09c5);
				if (p && p.len >= 24) verts.set(t.id(v), [t.f64(p, 0), t.f64(p, 1), t.f64(p, 2)]);
			}
			const edges = new Map<number, [number, number]>();
			for (const e of t.all(t.child(ents, 0x138a), 0x0bb8)) edges.set(t.id(e), [t.uint(t.child(e, 0x0bb9)), t.uint(t.child(e, 0x0bba))]);
			cache.set(key, (topo = { verts, edges }));
		}
		// caras
		for (const f of t.all(t.child(ents, 0x138b), 0x0dac)) {
			const c = common(f);
			if (c.hidden || hiddenLayer.has(c.layer)) {
				stats.hiddenSkipped++;
				continue;
			}
			const back = t.uint(t.child(f, 0x0daf));
			const name = matName.get(c.mat) ?? matName.get(back) ?? inherited;
			const loops: [number, number, number][][] = [];
			for (const lp of t.all(t.child(f, 0x0dae), 0x1194)) {
				const es: [number, number][] = [];
				for (const ce of t.all(t.child(lp, 0x1195), 0x0fa0)) {
					const e = topo.edges.get(t.uint(t.child(ce, 0x0fa1)));
					if (e) es.push(e);
				}
				const chain = chainLoop(es);
				if (!chain) continue;
				const pts = chain.map((id) => topo!.verts.get(id)).filter((p): p is [number, number, number] => !!p);
				if (pts.length >= 3) loops.push(pts);
			}
			if (!loops.length) continue;
			// proyección al plano de la cara y triangulación (contorno exterior = el de mayor área)
			const pl = t.child(f, 0x0dad);
			let nx = pl ? t.f64(pl, 0) : 0, ny = pl ? t.f64(pl, 1) : 0, nz = pl ? t.f64(pl, 2) : 1;
			const nn = Math.hypot(nx, ny, nz) || 1;
			nx /= nn; ny /= nn; nz /= nn;
			const ref = Math.abs(nx) < 0.9 ? [1, 0, 0] : [0, 1, 0];
			let ux = ny * ref[2] - nz * ref[1], uy = nz * ref[0] - nx * ref[2], uz = nx * ref[1] - ny * ref[0];
			const un = Math.hypot(ux, uy, uz);
			ux /= un; uy /= un; uz /= un;
			const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
			const to2 = (p: [number, number, number]) => new THREE.Vector2(p[0] * ux + p[1] * uy + p[2] * uz, p[0] * vx + p[1] * vy + p[2] * vz);
			const loops2 = loops.map((l) => l.map(to2));
			let outer = 0;
			loops2.forEach((l, i) => {
				if (Math.abs(THREE.ShapeUtils.area(l)) > Math.abs(THREE.ShapeUtils.area(loops2[outer]))) outer = i;
			});
			const contour = loops2[outer];
			const holes = loops2.filter((_, i) => i !== outer);
			const all3 = [loops[outer], ...loops.filter((_, i) => i !== outer)].flat();
			let tri: number[][];
			try {
				tri = THREE.ShapeUtils.triangulateShape(contour, holes);
			} catch {
				continue;
			}
			stats.faces++;
			for (const [a, b, cc] of tri) {
				for (const i of [a, b, cc]) {
					tmp.set(...all3[i]).applyMatrix4(xf);
					// SketchUp (X, Y, Z arriba, pulgadas) → escena (x = X, y = Z, z = −Y, metros)
					out.positions.push(tmp.x * INCH, tmp.z * INCH, -tmp.y * INCH);
				}
				out.materials.push(name);
				triPart.push(part);
				stats.triangles++;
			}
		}
		// instancias de componentes y grupos
		const insts = [...t.all(t.child(ents, 0x138c), 0x1964), ...t.all(t.child(ents, 0x138d), 0x1d4c).map((g) => t.child(g, 0x1964)).filter((n): n is Node => !!n)];
		for (const ins of insts) {
			const c = common(ins);
			if (c.hidden || hiddenLayer.has(c.layer)) {
				stats.hiddenSkipped++;
				continue;
			}
			const def = defs.get(t.uint(t.child(ins, 0x1967)));
			if (!def) continue;
			const tm = t.child(ins, 0x1966);
			const m = tm && tm.len >= 104 ? skpMatrix(Array.from({ length: 13 }, (_, i) => t.f64(tm, i))) : new THREE.Matrix4();
			stats.instances++;
			parts.push({ name: t.str(t.child(ins, 0x1965)) || def.name, parent: part });
			visit(def.ents, xf.clone().multiply(m), matName.get(c.mat) ?? inherited, depth + 1, parts.length - 1);
		}
	};
	visit(rootEnts, new THREE.Matrix4(), DEFAULT, 0, -1);

	if (!stats.triangles) throw new Error('El .skp no contiene caras visibles.');
	if (stats.hiddenSkipped)
		warnings.push(`${stats.hiddenSkipped} elementos ocultos o en etiquetas ocultas no se han importado (como en la vista de SketchUp).`);
	const hiddenNames = [...hiddenLayer].map((id) => layerName.get(id)).filter(Boolean);
	if (hiddenNames.length) warnings.push(`Etiquetas ocultas: ${hiddenNames.join(', ')}.`);
	return { version, tris: out, parts, triPart: Int32Array.from(triPart), colors, warnings, stats };
}
