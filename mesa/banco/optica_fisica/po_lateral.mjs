// Óptica física: campo reflejado por las facetas de la curva del lateral izquierdo (tira de 38 mm), respecto al directo
import { arcoWing, ARCO } from '/home/user/Acustica3D/mesa/gen_mesas.mjs';
const A = ARCO, W = arcoWing();
const src = [A.xc - A.D * Math.sin(Math.PI / 6), A.ye + A.D * Math.cos(Math.PI / 6) - 0.004, A.ear]; // x, y, z (SketchUp)
const ear = [A.xc, A.ye, A.ear];
const xl = A.xc - A.half; // cara de dentro del lateral izquierdo
const prof = W.prof; // [y, z]
// facetas de la parte de arriba del perfil (de yB hacia delante hasta la balda): segmentos con normal hacia arriba
const segs = [];
for (let i = 1; i + 1 < prof.length; i++) { const [y0, z0] = prof[i], [y1, z1] = prof[i + 1]; if (z0 < 0.7 || y1 > y0) break; segs.push([[y0, z0], [y1, z1]]); }
const R = Math.hypot(ear[0] - src[0], ear[1] - src[1], ear[2] - src[2]);
for (const f of [1000, 2000, 4000, 8000, 16000]) {
	const k = (2 * Math.PI * f) / 343;
	let re = 0, im = 0;
	const dx = Math.min(0.002, 343 / f / 12);
	for (const [[ya, za], [yb, zb]] of segs) {
		const L = Math.hypot(yb - ya, zb - za), n = [0, -(zb - za) / L, (yb - ya) / L]; // normal (y, z)
		if (n[2] < 0) { n[1] = -n[1]; n[2] = -n[2]; }
		const nu = Math.max(1, Math.ceil(L / dx)), nx = Math.ceil(0.038 / dx);
		for (let i = 0; i < nu; i++) for (let j = 0; j < nx; j++) {
			const t = (i + 0.5) / nu, p = [xl - 0.038 + ((j + 0.5) / nx) * 0.038, ya + t * (yb - ya), za + t * (zb - za)];
			const a = [p[0] - src[0], p[1] - src[1], p[2] - src[2]], b = [ear[0] - p[0], ear[1] - p[1], ear[2] - p[2]];
			const r1 = Math.hypot(...a), r2 = Math.hypot(...b);
			const ci = -(a[1] * n[1] + a[2] * n[2]) / r1, cr = (b[1] * n[1] + b[2] * n[2]) / r2;
			if (ci <= 0 || cr <= 0) continue; // la cara no ve a la fuente o al oído
			const dA = (L / nu) * (0.038 / nx);
			const amp = (k / (4 * Math.PI)) * (ci + cr) * dA / (r1 * r2);
			const ph = -k * (r1 + r2 - R);
			re += amp * Math.sin(ph); im += amp * Math.cos(ph); // ·j
		}
	}
	const rel = Math.hypot(re, im) * R; // respecto al directo (1/R)
	console.log(`${f} Hz: ${(20 * Math.log10(rel + 1e-12)).toFixed(1)} dB`);
}
