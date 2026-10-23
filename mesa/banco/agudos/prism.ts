import type { NamedTris } from '../lib/sim/testgeo';
/** prisma de x0 a x1; base y techo pueden ir inclinados entre zf (delante, hacia el oyente) y zb (detrás) */
export function prism(out: NamedTris, x0: number, x1: number, zf: number, zb: number, botF: number, botB: number, topF: number, topB: number, mat: string) {
	const P = (x: number, z: number, top: boolean): number[] => [x, z === zf ? (top ? topF : botF) : top ? topB : botB, z];
	const q = (a: number[], b: number[], c: number[], d: number[]) => { out.positions.push(...a, ...b, ...c, ...a, ...c, ...d); out.materials.push(mat, mat); };
	q(P(x0, zf, true), P(x1, zf, true), P(x1, zb, true), P(x0, zb, true));
	q(P(x0, zf, false), P(x0, zb, false), P(x1, zb, false), P(x1, zf, false));
	q(P(x0, zf, false), P(x1, zf, false), P(x1, zf, true), P(x0, zf, true));
	q(P(x0, zb, false), P(x0, zb, true), P(x1, zb, true), P(x1, zb, false));
	q(P(x0, zf, false), P(x0, zf, true), P(x0, zb, true), P(x0, zb, false));
	q(P(x1, zf, false), P(x1, zb, false), P(x1, zb, true), P(x1, zf, true));
}
