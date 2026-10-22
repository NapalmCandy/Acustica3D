// Búsqueda bayesiana de la posición de escucha.
//
// Cada posición de la cabeza cuesta una simulación completa (de segundos a minutos), así que en vez de
// recorrer la sala con una rejilla se aprende sobre la marcha dónde puede estar lo mejor. Un proceso
// gaussiano (kriging) estima la puntuación en todo el suelo, con su incertidumbre, a partir de las
// posiciones ya simuladas; la siguiente se simula donde la mejora esperada (expected improvement) es
// mayor. Así reparte el trabajo entre explorar zonas sin probar y afinar alrededor de las buenas.

export type P2 = [number, number];

const SQRT5 = Math.sqrt(5);

/** Núcleo de Matérn 5/2: suave pero sin exigir que la puntuación lo sea tanto como un gaussiano. */
function matern52(r: number, ell: number): number {
	const s = (SQRT5 * r) / ell;
	return (1 + s + (s * s) / 3) * Math.exp(-s);
}

const dist = (a: P2, b: P2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Cholesky en el sitio (triangular inferior, por filas). false si la matriz no es definida positiva. */
function cholesky(A: Float64Array, n: number): boolean {
	for (let j = 0; j < n; j++) {
		let d = A[j * n + j];
		for (let k = 0; k < j; k++) d -= A[j * n + k] ** 2;
		if (d <= 0) return false;
		d = Math.sqrt(d);
		A[j * n + j] = d;
		for (let i = j + 1; i < n; i++) {
			let s = A[i * n + j];
			for (let k = 0; k < j; k++) s -= A[i * n + k] * A[j * n + k];
			A[i * n + j] = s / d;
		}
		for (let k = j + 1; k < n; k++) A[j * n + k] = 0;
	}
	return true;
}

/** L·x = b */
function solveLower(L: Float64Array, n: number, b: Float64Array): Float64Array {
	const x = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		let s = b[i];
		for (let k = 0; k < i; k++) s -= L[i * n + k] * x[k];
		x[i] = s / L[i * n + i];
	}
	return x;
}

/** Lᵀ·x = b */
function solveUpper(L: Float64Array, n: number, b: Float64Array): Float64Array {
	const x = new Float64Array(n);
	for (let i = n - 1; i >= 0; i--) {
		let s = b[i];
		for (let k = i + 1; k < n; k++) s -= L[k * n + i] * x[k];
		x[i] = s / L[i * n + i];
	}
	return x;
}

/** Proceso gaussiano sobre el plano con media constante. Los hiperparámetros (longitud de correlación
 *  y ruido) se eligen por verosimilitud marginal entre unos pocos valores razonables para una sala. */
export class GP {
	private constructor(
		private X: P2[],
		private L: Float64Array,
		private alpha: Float64Array,
		private mean: number,
		private scale: number,
		readonly ell: number,
		readonly noise: number
	) {}

	static fit(X: P2[], y: number[], ells = [0.25, 0.4, 0.6, 0.9, 1.4, 2.2], noises = [1e-3, 1e-2, 5e-2]): GP {
		const n = X.length;
		const mean = y.reduce((a, b) => a + b, 0) / (n || 1);
		const sd = Math.sqrt(y.reduce((a, b) => a + (b - mean) ** 2, 0) / (n || 1));
		const scale = sd > 1e-9 ? sd : 1;
		const z = Float64Array.from(y, (v) => (v - mean) / scale);
		let best: GP | null = null;
		let bestLml = -Infinity;
		for (const ell of ells)
			for (const noise of noises) {
				const K = new Float64Array(n * n);
				for (let i = 0; i < n; i++)
					for (let j = 0; j <= i; j++) {
						const k = matern52(dist(X[i], X[j]), ell) + (i === j ? noise + 1e-9 : 0);
						K[i * n + j] = k;
						K[j * n + i] = k;
					}
				if (!cholesky(K, n)) continue;
				const alpha = solveUpper(K, n, solveLower(K, n, z));
				let lml = 0;
				for (let i = 0; i < n; i++) lml += -0.5 * z[i] * alpha[i] - Math.log(K[i * n + i]);
				if (lml > bestLml) {
					bestLml = lml;
					best = new GP(X.slice(), K, alpha, mean, scale, ell, noise);
				}
			}
		if (!best) throw new Error('No se pudo ajustar el modelo de la búsqueda bayesiana.');
		return best;
	}

	/** media y desviación típica estimadas de la puntuación en p */
	predict(p: P2): { mu: number; sd: number } {
		const n = this.X.length;
		const k = new Float64Array(n);
		let mu = 0;
		for (let i = 0; i < n; i++) {
			k[i] = matern52(dist(p, this.X[i]), this.ell);
			mu += k[i] * this.alpha[i];
		}
		const v = solveLower(this.L, n, k);
		let vv = 0;
		for (let i = 0; i < n; i++) vv += v[i] * v[i];
		return { mu: this.mean + this.scale * mu, sd: this.scale * Math.sqrt(Math.max(1e-12, 1 - vv)) };
	}
}

/** Φ (normal acumulada), con la aproximación de erf de Abramowitz-Stegun 7.1.26 (error < 1,5·10⁻⁷). */
function normCdf(x: number): number {
	const t = 1 / (1 + (0.3275911 * Math.abs(x)) / Math.SQRT2);
	const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
	return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** Mejora esperada sobre `best` (en puntos de puntuación). `xi` empuja un poco hacia explorar. */
export function expectedImprovement(mu: number, sd: number, best: number, xi = 0.05): number {
	const d = mu - best - xi;
	if (sd < 1e-9) return Math.max(0, d);
	const z = d / sd;
	return d * normCdf(z) + (sd * Math.exp(-(z * z) / 2)) / Math.sqrt(2 * Math.PI);
}

/** Puntos de partida repartidos por la sala: cada uno, el candidato más lejano a todos los ya
 *  elegidos, a `taken` (los que ya se han simulado) y al borde de la zona (contado doble: así no se
 *  van a los rincones, que es donde un reparto «lo más lejos posible» los pondría primero). */
export function spreadPoints(cands: P2[], n: number, taken: P2[] = []): number[] {
	const N = cands.length;
	const minD = new Float64Array(N).fill(Infinity);
	// separación de la rejilla de candidatos y borde: los que no tienen sus 4 vecinos
	let h = Infinity;
	for (let i = 1; i < Math.min(N, 400); i++) {
		const d = dist(cands[0], cands[i]);
		if (d > 1e-6) h = Math.min(h, d);
	}
	if (Number.isFinite(h)) {
		const key = (x: number, z: number) => `${Math.round(x / h)}|${Math.round(z / h)}`;
		const have = new Set(cands.map((p) => key(p[0], p[1])));
		const edge = cands.filter(([x, z]) => !have.has(key(x + h, z)) || !have.has(key(x - h, z)) || !have.has(key(x, z + h)) || !have.has(key(x, z - h)));
		for (const e of edge) for (let i = 0; i < N; i++) minD[i] = Math.min(minD[i], 2 * (dist(cands[i], e) + h / 2));
	}
	for (const t of taken) for (let i = 0; i < N; i++) minD[i] = Math.min(minD[i], dist(cands[i], t));
	const out: number[] = [];
	while (out.length < Math.min(n, N)) {
		let k = -1;
		for (let i = 0; i < N; i++) if (minD[i] > 1e-9 && (k < 0 || minD[i] > minD[k])) k = i;
		if (k < 0) break;
		out.push(k);
		for (let i = 0; i < N; i++) minD[i] = Math.min(minD[i], dist(cands[i], cands[k]));
	}
	return out;
}

/** Siguiente candidato que simular: el de mayor mejora esperada entre los que están a más de `gap` m
 *  de lo ya simulado. null si no queda ninguno. */
export function proposeNext(cands: P2[], X: P2[], y: number[], gap = 0.05, xi = 0.05): { index: number; ei: number; gp: GP } | null {
	const gp = GP.fit(X, y);
	const best = Math.max(...y);
	let index = -1, ei = -1;
	for (let i = 0; i < cands.length; i++) {
		if (X.some((x) => dist(x, cands[i]) < gap)) continue;
		const { mu, sd } = gp.predict(cands[i]);
		const e = expectedImprovement(mu, sd, best, xi);
		if (e > ei) (ei = e), (index = i);
	}
	return index < 0 ? null : { index, ei, gp };
}

/** Búsqueda completa con una función objetivo asíncrona (la simulación). `f` devuelve la puntuación,
 *  o null si en ese punto no cabe ninguna colocación (se le da la peor vista hasta entonces). Se para
 *  al agotar el presupuesto o, si se pide `minEi`, cuando ya no se espera mejorar ni esos puntos (por
 *  defecto no: con pocas muestras el modelo puede no haber visto aún un máximo estrecho). */
export async function bayesSearch(
	cands: P2[],
	f: (p: P2, phase: 'inicio' | 'bayes') => Promise<number | null>,
	opts: { budget: number; nInit: number; taken?: { p: P2; y: number }[]; minEi?: number; minAfterInit?: number }
): Promise<{ X: P2[]; y: number[] }> {
	const X: P2[] = [], y: number[] = [];
	const failed: P2[] = [];
	for (const t of opts.taken ?? []) X.push(t.p), y.push(t.y);
	const worst = () => (y.length ? Math.min(...y) : null);
	const tell = (p: P2, v: number | null) => {
		const w = v ?? worst();
		if (w === null) failed.push(p);
		else X.push(p), y.push(w);
	};
	let used = 0;
	for (const i of spreadPoints(cands, opts.nInit, X)) {
		if (used >= opts.budget) break;
		tell(cands[i], await f(cands[i], 'inicio'));
		used++;
	}
	// los que fallaron antes de tener ninguna puntuación cuentan como los peores
	for (const p of failed.splice(0)) if (y.length) X.push(p), y.push(Math.min(...y));
	const minEi = opts.minEi ?? 0;
	const minAfterInit = opts.minAfterInit ?? 6;
	let extra = 0;
	while (used < opts.budget && y.length >= 2) {
		const nx = proposeNext(cands, X, y);
		if (!nx) break;
		if (nx.ei < minEi && extra >= minAfterInit) break;
		tell(cands[nx.index], await f(cands[nx.index], 'bayes'));
		used++;
		extra++;
	}
	return { X, y };
}
