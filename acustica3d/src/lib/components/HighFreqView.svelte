<script lang="ts">
	// Medios y agudos (200 Hz – 20 kHz): reflexiones por el método de la imagen más la cola difusa.
	import { app, toSketchup } from '../state.svelte';
	import { khResponse, type Cx } from '../acoustics/speakers';
	import { pathAmplitude, octInterp, KH_Q, C_SOUND, type Path } from '../hf/imageSource';
	import type { HfReply, HfRequest } from '../hf/hf.worker';
	import HfWorker from '../hf/hf.worker?worker';
	import ResponseChart, { type Curve } from './ResponseChart.svelte';
	import type { V3 } from '../sim/voxel';

	let order = $state(3);
	let smooth = $state(6);
	let paths = $state.raw<Path[] | null>(null);
	let names = $state.raw<string[]>([]);
	let geom = $state.raw<{ tris: Float32Array; triMat: Int32Array } | null>(null);
	let busy = $state(false);
	let ms = $state(0);
	let error = $state<string | null>(null);
	let worker: Worker | null = null;
	let reqId = 0;

	// la geometría que cuenta (con la casilla «cuenta» de cada material y los objetos) y las posiciones
	const inputKey = $derived.by(() => {
		if (!app.tris) return '';
		const ign = app.materialNames.filter((n) => app.matMap[n]?.libId === 'ignorar').join('|');
		return JSON.stringify([app.modelName, app.tris.materials.length, ign, app.objects, app.positions.khL, app.positions.khR, app.positions.listener, order]);
	});
	$effect(() => {
		const key = inputKey;
		if (!key) return;
		const t = setTimeout(() => {
			try {
				const inp = app.simInput();
				const pos = $state.snapshot(app.positions) as Record<string, V3>;
				names = inp.names;
				geom = { tris: inp.tris.slice(), triMat: inp.triMat.slice() };
				worker ??= new HfWorker();
				const id = ++reqId;
				busy = true;
				error = null;
				worker.onmessage = (ev: MessageEvent<HfReply>) => {
					const m = ev.data;
					if (m.reqId !== reqId) return;
					busy = false;
					if ('error' in m) error = m.error;
					else (paths = m.paths), (ms = m.ms);
				};
				worker.onerror = (e) => {
					busy = false;
					error = e.message || 'El cálculo de reflexiones se ha cortado.';
				};
				const req: HfRequest = {
					reqId: id, tris: inp.tris, triMat: inp.triMat, ear: pos.listener, maxOrder: order,
					sources: [{ id: 'khL', pos: pos.khL }, { id: 'khR', pos: pos.khR }]
				};
				worker.postMessage(req, [req.tris.buffer, req.triMat.buffer]);
			} catch (e) {
				error = e instanceof Error ? e.message : String(e);
			}
		}, 300);
		return () => clearTimeout(t);
	});
	$effect(() => () => worker?.terminate());

	// absorción de cada material por octavas, de 63 Hz a 16 kHz (la de 8 kHz vale para 16 kHz)
	const alphas = $derived.by(() => {
		void JSON.stringify(app.matMap);
		void JSON.stringify(app.objects);
		return names.map((n) => {
			const a = app.alphaOf(n);
			return [...a, a[a.length - 1]];
		});
	});
	const alphaOf = (m: number) => alphas[m] ?? [0, 0, 0, 0, 0, 0, 0, 0, 0];

	const FREQS: number[] = [];
	for (let f = 100; f <= 20000 * 1.0001; f *= Math.pow(2, 1 / 48)) FREQS.push(f);

	/** Cola difusa (energía relativa al directo a 1 m) por frecuencia: campo reverberante de la sala
	 *  (Sabine) que llega después de las reflexiones calculadas una a una. */
	const diffuse = $derived.by(() => {
		if (!geom) return null;
		// superficie de cada material que da al aire: la que cuenta la simulación de graves sobre su
		// rejilla; sin ella, la de los triángulos (la mitad: las capas tienen dos caras)
		const areaBy = new Map<number, number>();
		if (app.result) for (const [n, a] of app.result.areaByMat) if (names.includes(n)) areaBy.set(names.indexOf(n), a);
		if (!areaBy.size) {
			const { tris, triMat } = geom;
			for (let t = 0; t < triMat.length; t++) {
				if (triMat[t] < 0) continue;
				const o = t * 9;
				const ax = tris[o + 3] - tris[o], ay = tris[o + 4] - tris[o + 1], az = tris[o + 5] - tris[o + 2];
				const bx = tris[o + 6] - tris[o], by = tris[o + 7] - tris[o + 1], bz = tris[o + 8] - tris[o + 2];
				const a = Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) / 4;
				areaBy.set(triMat[t], (areaBy.get(triMat[t]) ?? 0) + a);
			}
		}
		let S = 0;
		for (const a of areaBy.values()) S += a;
		const V = app.result?.grid.airVolume ?? (app.bbox ? [0, 1, 2].reduce((v, k) => v * (app.bbox!.max[k] - app.bbox!.min[k]), 0.8) : 50);
		const mfp = (4 * V) / S;
		return FREQS.map((f) => {
			let A = 0;
			for (const [m, a] of areaBy) A += a * octInterp(alphaOf(m), f);
			const abar = Math.min(0.95, A / S);
			const T = (0.161 * V) / Math.max(1e-3, -S * Math.log(1 - abar)); // Eyring
			const R = (S * abar) / (1 - abar);
			const tCut = ((order + 0.5) * mfp) / C_SOUND;
			return { T, late: (16 * Math.PI) / (R * octInterp(KH_Q, f)) * Math.exp((-13.8 * tCut) / T) };
		});
	});

	const aimOf = (id: string): V3 => {
		const s = id === 'khL' ? app.positions.khL : app.positions.khR;
		const e = app.positions.listener;
		const d = [e[0] - s[0], e[1] - s[1], e[2] - s[2]];
		const l = Math.hypot(d[0], d[1], d[2]) || 1;
		return [d[0] / l, d[1] / l, d[2] / l];
	};

	const curves = $derived.by(() => {
		if (!paths || !diffuse) return null;
		void JSON.stringify(app.kh);
		const which = (ids: string[]) => {
			const pw = FREQS.map((f, fi) => {
				const kh = khResponse(f, app.kh) as Cx;
				let re = 0, im = 0;
				for (const p of paths!) {
					if (!ids.includes(p.src)) continue;
					const a = pathAmplitude(p, f, aimOf(p.src), alphaOf);
					const ph = (-2 * Math.PI * f * p.length) / C_SOUND;
					re += a * Math.cos(ph);
					im += a * Math.sin(ph);
				}
				const k2 = kh[0] * kh[0] + kh[1] * kh[1];
				return (re * re + im * im) * k2 + ids.length * diffuse[fi].late * k2;
			});
			// suavizado en potencia de 1/N de octava
			const half = smooth ? Math.pow(2, 1 / (2 * smooth)) : 1;
			return FREQS.map((f, i) => {
				if (!smooth) return 10 * Math.log10(pw[i] + 1e-12);
				let s = 0, n = 0;
				for (let j = 0; j < FREQS.length; j++) if (FREQS[j] >= f / half && FREQS[j] <= f * half) (s += pw[j]), n++;
				return 10 * Math.log10(s / n + 1e-12);
			});
		};
		const out: Curve[] = [
			{ label: 'Los dos KH', color: '#3b3a36', f: FREQS, db: which(['khL', 'khR']) },
			{ label: 'Solo el izquierdo', color: '#2a78d6', f: FREQS, db: which(['khL']), dash: true },
			{ label: 'Solo el derecho', color: '#eb6834', f: FREQS, db: which(['khR']), dash: true }
		];
		return out;
	});
	const yr = $derived.by(() => {
		if (!curves) return { ymin: -20, ymax: 15 };
		let hi = -Infinity;
		for (const c of curves) for (const v of c.db) hi = Math.max(hi, v);
		const ymax = Math.ceil((hi + 3) / 5) * 5;
		return { ymin: ymax - 35, ymax };
	});

	const surf = (m: number) => (names[m] ?? '?').replace(/^◆ /, '');
	/** reflexiones con su retardo y nivel respecto al directo de su KH (media de 1 a 8 kHz) */
	const refl = $derived.by(() => {
		if (!paths) return [];
		const band = [1000, 2000, 4000, 8000];
		const direct = new Map(paths.filter((p) => p.order === 0).map((p) => [p.src, p]));
		const lvl = (p: Path) => band.reduce((s, f) => s + pathAmplitude(p, f, aimOf(p.src), alphaOf) ** 2, 0) / band.length;
		return paths
			.filter((p) => p.order > 0)
			.map((p) => {
				const d = direct.get(p.src)!;
				return { p, ms: ((p.length - d.length) / C_SOUND) * 1000, db: 10 * Math.log10(lvl(p) / lvl(d)) };
			})
			.sort((a, b) => a.ms - b.ms);
	});
	const problems = $derived(refl.filter((r) => r.ms <= 20 && r.db > -20).sort((a, b) => b.db - a.db));

	// reflectograma
	let rw = $state(600);
	const rh = 200;
	const RM = { l: 40, r: 10, t: 10, b: 26 };
	const TMAX = 60;
	const rx = (t: number) => RM.l + (t / TMAX) * (rw - RM.l - RM.r);
	let hover = $state<(typeof refl)[number] | null>(null);
	const fmt = (v: number, d = 1) => v.toFixed(d).replace('.', ',');
	const sk = (p: V3) => toSketchup(p).map((v) => fmt(v, 2)).join(' · ');
</script>

<div class="grid h-full min-h-0 grid-cols-1 gap-4 overflow-y-auto lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
	<div class="flex min-h-0 flex-col gap-3">
		<div class="flex flex-wrap items-center gap-3 text-xs text-muted">
			<label class="flex items-center gap-1.5">Reflexiones hasta orden
				<select class="input py-0.5" bind:value={order}><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option><option value={4}>4 (lento)</option></select>
			</label>
			<label class="flex items-center gap-1.5">Suavizado
				<select class="input py-0.5" bind:value={smooth}><option value={0}>ninguno</option><option value={24}>1/24 oct</option><option value={12}>1/12 oct</option><option value={6}>1/6 oct</option><option value={3}>1/3 oct</option></select>
			</label>
			{#if busy}<span>Buscando reflexiones…</span>{:else if paths}<span>{refl.length} reflexiones en {fmt(ms / 1000, 1)} s</span>{/if}
			{#if error}<span class="text-red-700 dark:text-red-300">{error}</span>{/if}
		</div>
		<div class="h-[300px] min-h-[240px]">
			{#if curves}
				<ResponseChart {curves} xmin={100} xmax={20000} ymin={yr.ymin} ymax={yr.ymax} yLabel="dB (0 = 1 KH a 1 m en su eje)" />
			{:else}
				<div class="flex h-full items-center justify-center text-sm text-muted">{app.tris ? 'Calculando…' : 'Carga tu modelo de SketchUp.'}</div>
			{/if}
		</div>
		<div>
			<div class="mb-1 text-xs font-medium text-ink">Reflectograma: cada reflexión que llega a tu oído (retardo respecto al directo y nivel)</div>
			<div class="relative" bind:clientWidth={rw}>
				<svg width={rw} height={rh} role="img" aria-label="Reflexiones por retardo y nivel">
					{#each [0, -10, -20, -30, -40] as d}
						<line x1={RM.l} x2={rw - RM.r} y1={RM.t + (-d / 40) * (rh - RM.t - RM.b)} y2={RM.t + (-d / 40) * (rh - RM.t - RM.b)} stroke="var(--c-grid)" stroke-width="0.7" />
						<text x={RM.l - 5} y={RM.t + (-d / 40) * (rh - RM.t - RM.b) + 3.5} text-anchor="end" font-size="10" fill="var(--c-muted)">{d}</text>
					{/each}
					{#each [0, 10, 20, 30, 40, 50, 60] as t}
						<text x={rx(t)} y={rh - RM.b + 14} text-anchor="middle" font-size="10" fill="var(--c-muted)">{t}</text>
					{/each}
					<text x={(RM.l + rw - RM.r) / 2} y={rh - 2} text-anchor="middle" font-size="10" fill="var(--c-muted)">ms después del directo · dB respecto al directo</text>
					<!-- zona libre de reflexiones: nada por encima de −20 dB en los primeros 20 ms -->
					<rect x={rx(0)} y={RM.t} width={rx(20) - rx(0)} height={(20 / 40) * (rh - RM.t - RM.b)} fill="rgba(235,104,52,0.08)" />
					<line x1={rx(0)} x2={rx(20)} y1={RM.t + 0.5 * (rh - RM.t - RM.b)} y2={RM.t + 0.5 * (rh - RM.t - RM.b)} stroke="#eb6834" stroke-dasharray="4 3" />
					{#each refl.filter((r) => r.ms <= TMAX && r.db > -40) as r}
						{@const y = RM.t + (Math.min(40, -r.db) / 40) * (rh - RM.t - RM.b)}
						<line x1={rx(r.ms)} x2={rx(r.ms)} y1={rh - RM.b} y2={y} stroke={r.p.src === 'khL' ? '#2a78d6' : '#eb6834'} stroke-width={r.p.order === 1 ? 2 : 1} opacity={r.p.order === 1 ? 1 : 0.55} />
						<circle cx={rx(r.ms)} cy={y} r="6" fill="transparent" role="presentation" onpointerenter={() => (hover = r)} onpointerleave={() => (hover = null)} />
					{/each}
				</svg>
				{#if hover}
					<div class="pointer-events-none absolute top-1 rounded-md border border-line bg-panel px-2 py-1.5 text-xs shadow-md" style="left:{Math.min(rx(hover.ms) + 10, rw - 260)}px">
						<div class="font-semibold text-ink">{hover.p.src === 'khL' ? 'KH izquierdo' : 'KH derecho'} · {fmt(hover.ms)} ms · {fmt(hover.db)} dB</div>
						<div class="text-ink">{hover.p.mats.map(surf).join(' → ')}</div>
					</div>
				{/if}
			</div>
			<div class="mt-1 flex flex-wrap gap-x-3 text-[10px] text-muted">
				<span><span class="inline-block h-2 w-3 align-middle" style="background:#2a78d6"></span> KH izquierdo</span>
				<span><span class="inline-block h-2 w-3 align-middle" style="background:#eb6834"></span> KH derecho</span>
				<span>gruesas: un rebote; finas: varios</span>
				<span>zona sombreada: debería quedar vacía (−20 dB en los primeros 20 ms)</span>
			</div>
		</div>
	</div>
	<div class="min-h-0 space-y-3 text-xs">
		<div class="rounded-md border border-line p-2.5">
			<div class="mb-1 font-medium text-ink">
				{#if !paths}Reflexiones tempranas{:else if problems.length}{problems.length} reflexiones tempranas fuertes (en los primeros 20 ms, por encima de −20 dB){:else}Sin reflexiones fuertes en los primeros 20 ms: zona libre de reflexiones{/if}
			</div>
			{#if problems.length}
				<table class="w-full" id="hf-problems">
					<thead class="text-muted"><tr><th class="text-left font-medium">KH</th><th class="text-right font-medium">ms</th><th class="text-right font-medium">dB</th><th class="pl-2 text-left font-medium">Rebota en (punto X · Y · Z, m)</th></tr></thead>
					<tbody>
						{#each problems.slice(0, 14) as r}
							<tr class="border-t border-line text-ink">
								<td>{r.p.src === 'khL' ? 'izq.' : 'der.'}</td><td class="text-right tabular-nums">{fmt(r.ms)}</td><td class="text-right tabular-nums">{fmt(r.db)}</td>
								<td class="pl-2">{#each r.p.mats as m, i}<div>{surf(m)} <span class="text-muted">({sk(r.p.points[i + 1])})</span></div>{/each}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</div>
		<div class="rounded-md border border-line p-2.5 text-muted">
			<p class="mb-1 font-medium text-ink">Cómo se calcula</p>
			<ul class="list-disc space-y-1 pl-4">
				<li>Por encima de unos cientos de Hz el sonido se comporta como rayos: cada reflexión es una fuente «imagen» detrás de la superficie. Se buscan todas las que llegan a tu oído hasta el orden elegido, comprobando que el rebote cae en una superficie real y que nada tapa el camino (la mesa, la pantalla, las trampas…).</li>
				<li>Cada rebote pierde lo que absorbe su material en esa octava; la directividad de los KH 120 A (apuntando a tu oído) y el aire atenúan los agudos. Después se suma la cola difusa de la sala (Eyring).</li>
				<li>Desmarca «cuenta» en un material (la mesa) y se recalcula al momento: así ves cuánto cambia.</li>
				<li>La directividad del KH 120 es la medida por Neumann (diagramas horizontal y vertical del manual); detrás del altavoz, estimada. Las superficies son espejos (sin difusión) y hay un solo punto de escucha (sin la forma de la cabeza). Por debajo de ~300 Hz manda la simulación de graves.</li>
			</ul>
		</div>
	</div>
</div>
