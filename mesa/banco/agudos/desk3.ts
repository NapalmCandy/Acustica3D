// Mesa paramétrica para el banco de agudos (coordenadas de la app: x, y arriba, z = −Y de SketchUp).
// Triángulo de 60°: oído en E, KH a distancia D del oído (al punto del eje en el frontal), girados hacia él.
import type { V3 } from '../lib/sim/voxel';

export interface G { positions: number[]; materials: string[] }
export const g = (): G => ({ positions: [], materials: [] });

/** prisma de base poligonal convexa (en x,z) entre y0 e y1 */
export function extrude(out: G, poly: [number, number][], y0: number, y1: number, mat: string) {
	const n = poly.length;
	const tri = (a: V3, b: V3, c: V3) => { out.positions.push(...a, ...b, ...c); out.materials.push(mat); };
	for (let i = 1; i + 1 < n; i++) {
		tri([poly[0][0], y1, poly[0][1]], [poly[i][0], y1, poly[i][1]], [poly[i + 1][0], y1, poly[i + 1][1]]);
		tri([poly[0][0], y0, poly[0][1]], [poly[i + 1][0], y0, poly[i + 1][1]], [poly[i][0], y0, poly[i][1]]);
	}
	for (let i = 0; i < n; i++) {
		const a = poly[i], b = poly[(i + 1) % n];
		tri([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]]);
		tri([a[0], y0, a[1]], [b[0], y1, b[1]], [a[0], y1, a[1]]);
	}
}
/** caja de lados inclinables: polígono abajo y polígono arriba distintos (mismo número de vértices, convexos) */
export function loft(out: G, lo: [number, number, number][], hi: [number, number, number][], mat: string) {
	const n = lo.length;
	const tri = (a: number[], b: number[], c: number[]) => { out.positions.push(...a, ...b, ...c); out.materials.push(mat); };
	for (let i = 1; i + 1 < n; i++) { tri(hi[0], hi[i], hi[i + 1]); tri(lo[0], lo[i + 1], lo[i]); }
	for (let i = 0; i < n; i++) { const j = (i + 1) % n; tri(lo[i], lo[j], hi[j]); tri(lo[i], hi[j], hi[i]); }
}

export interface Tri { E: V3; D: number; S: number; khL: V3; khR: V3; fwdL: [number, number]; fwdR: [number, number] }
/** triángulo equilátero (o de apertura `ap`) con el oído en E; las fuentes, 1,5 cm delante del frontal */
export function triangle(E: V3, D: number, ap = 60): Tri {
	const h = (ap / 2) * (Math.PI / 180);
	const mk = (s: -1 | 1) => {
		const p: V3 = [E[0] + s * D * Math.sin(h), E[1], E[2] - D * Math.cos(h)];
		const f: [number, number] = [(E[0] - p[0]) / D, (E[2] - p[2]) / D]; // hacia el oído (en planta)
		return { p, f };
	};
	const L = mk(-1), R = mk(1);
	return { E, D, S: 2 * D * Math.sin(h), khL: L.p, khR: R.p, fwdL: L.f, fwdR: R.f };
}
export const SRC_OFF = 0.004; // 4 mm: un peine con una superficie en el plano del frontal caería por encima de 40 kHz
export const sources = (t: Tri) => ({
	khL: [t.khL[0] + SRC_OFF * t.fwdL[0], t.khL[1], t.khL[2] + SRC_OFF * t.fwdL[1]] as V3,
	khR: [t.khR[0] + SRC_OFF * t.fwdR[0], t.khR[1], t.khR[2] + SRC_OFF * t.fwdR[1]] as V3
});

/** cajas de los KH 120 (18,2 × 27,7 × 23 cm, eje a 17 cm de la base): tapan lo que tienen debajo y detrás.
 *  El frontal es absorbente en el cálculo (la fuente está justo delante; su directividad medida ya lo incluye) */
export function cabinets(out: G, t: Tri, lift = 0.002) {
	for (const [p, f] of [[t.khL, t.fwdL], [t.khR, t.fwdR]] as [V3, [number, number]][]) {
		const r: [number, number] = [-f[1], f[0]]; // a la derecha mirando hacia el oído... da igual el signo
		const w = 0.091, d = 0.23, y0 = p[1] - 0.17 + lift, y1 = p[1] - 0.17 + 0.277;
		const c = (a: number, b: number): [number, number] => [p[0] + a * r[0] - b * f[0], p[2] + a * r[1] - b * f[1]];
		const poly = [c(-w, 0), c(w, 0), c(w, d), c(-w, d)];
		const box = g();
		extrude(box, poly, y0, y1, 'Caja KH');
		// la cara delantera (los dos triángulos del lado 0→1) pasa a «Frente KH»
		// en extrude, los laterales van después de las tapas: tapas = 2·(n−2) = 4 triángulos; lado 0 = triángulos 4 y 5
		box.materials[4] = box.materials[5] = 'Frente KH';
		// la base tampoco devuelve sonido (está apoyada; su canto ya va en la directividad medida): índices 1 y 3
		box.materials[1] = box.materials[3] = 'Frente KH';
		out.positions.push(...box.positions); out.materials.push(...box.materials);
	}
}

/** arco (en planta) centrado en el oído: punto a radio r y ángulo a (0 = de frente, + a la derecha) */
export const arc = (E: V3, r: number, aDeg: number): [number, number] => { const a = (aDeg * Math.PI) / 180; return [E[0] + r * Math.sin(a), E[2] - r * Math.cos(a)]; };
/** sector de corona entre los radios r0 < r1 y los ángulos a0 < a1, en trozos convexos */
export function annulus(out: G, E: V3, r0: number, r1: number, a0: number, a1: number, y0: number, y1: number, mat: string, step = 3) {
	const n = Math.max(1, Math.ceil((a1 - a0) / step));
	for (let i = 0; i < n; i++) {
		const aa = a0 + ((a1 - a0) * i) / n, ab = a0 + ((a1 - a0) * (i + 1)) / n;
		extrude(out, [arc(E, r0, aa), arc(E, r0, ab), arc(E, r1, ab), arc(E, r1, aa)], y0, y1, mat);
	}
}
/** franja entre un arco delantero (radio r, centrado en el oído) y una recta trasera z = zb, de x0 a x1 */
export function arcToLine(out: G, E: V3, r: number, zb: number, x0: number, x1: number, y0: number, y1: number, mat: string, dx = 0.03) {
	const zf = (x: number) => E[2] - Math.sqrt(Math.max(0, r * r - (x - E[0]) ** 2));
	const n = Math.ceil((x1 - x0) / dx);
	for (let i = 0; i < n; i++) {
		const xa = x0 + ((x1 - x0) * i) / n, xb = x0 + ((x1 - x0) * (i + 1)) / n;
		if (zf(xa) <= zb + 0.005 && zf(xb) <= zb + 0.005) continue;
		extrude(out, [[xa, Math.max(zb, zf(xa))], [xa, zb], [xb, zb], [xb, Math.max(zb, zf(xb))]].reverse() as [number, number][], y0, y1, mat);
	}
}
export const box = (out: G, x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, mat: string) =>
	extrude(out, [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], y0, y1, mat);
