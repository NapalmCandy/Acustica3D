// Óptica física para una tira horizontal (cara de arriba, rígida): nivel respecto al directo
import { ARCO } from '/home/user/Acustica3D/mesa/gen_mesas.mjs';
const A = ARCO;
const src = [A.xc - A.D * Math.sin(Math.PI / 6), A.ye + A.D * Math.cos(Math.PI / 6) - 0.004, A.ear];
const ear = [A.xc, A.ye, A.ear];
const R = Math.hypot(ear[0] - src[0], ear[1] - src[1], ear[2] - src[2]);
const strip = (x0, x1, y0, y1, z, label) => {
	const out = [];
	for (const f of [1000, 2000, 4000, 8000, 16000]) {
		const k = (2 * Math.PI * f) / 343, h = Math.min(0.003, 343 / f / 12);
		let re = 0, im = 0;
		for (let x = x0 + h / 2; x < x1; x += h) for (let y = y0 + h / 2; y < y1; y += h) {
			const a = [x - src[0], y - src[1], z - src[2]], b = [ear[0] - x, ear[1] - y, ear[2] - z];
			const r1 = Math.hypot(...a), r2 = Math.hypot(...b), ci = -a[2] / r1, cr = b[2] / r2;
			if (ci <= 0 || cr <= 0) continue;
			const amp = ((k / (4 * Math.PI)) * (ci + cr) * h * h) / (r1 * r2), ph = -k * (r1 + r2 - R);
			re += amp * Math.cos(ph); im += amp * Math.sin(ph);
		}
		out.push(`${f / 1000}k ${(20 * Math.log10(Math.hypot(re, im) * R + 1e-12)).toFixed(1)}`);
	}
	console.log(label.padEnd(44), out.join('  '));
};
const yB = A.ye + A.D * Math.cos(Math.PI / 6) + 0.43;
strip(A.xc - 0.42, A.xc + 0.42, yB - 0.02, yB, 0.905, 'trasera, canto de arriba en el rebaje (2 cm)');
strip(A.xc - 0.42, A.xc - 0.40, yB - 0.3, yB, 0.905, 'lado del rebaje (2 cm × 30 cm)');
strip(1.0, 3.1, 4.794 - 0.2, 4.794 + 0.2, 0.905, 'referencia: tablero grande en el rebote');
