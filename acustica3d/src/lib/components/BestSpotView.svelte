<script lang="ts">
	import { app, toSketchup } from '../state.svelte';
	import { sourceGain } from '../sim/controller';
	import { computeScores, cellResponse, nearestCell, CRITERIA, DEFAULT_WEIGHTS, type Criterion } from '../analysis/score';
	import ResponseChart, { type Curve } from './ResponseChart.svelte';
	import { mapOverlay } from '../mapOverlay.svelte';
	import { SCORE_RAMP, YOU_COLOR, BEST_COLOR, scoreColor } from '../colors';
	import type { V3 } from '../sim/voxel';

	let canvas: HTMLCanvasElement;
	let cw = $state(500);
	let ch = $state(300);

	// divergente rojo (peor) → blanco → verde (mejor), relativa a esta sala: el peor sitio válido
	// es rojo puro y el mejor verde puro, para que se vean bien las diferencias
	const RAMP = SCORE_RAMP;
	const YOU = YOU_COLOR; // tu posición: morado, se distingue sobre rojo, blanco y verde
	const BEST = BEST_COLOR;
	const color = scoreColor;

	const scores = $derived.by(() => {
		const sp = app.spectra;
		const res = app.result;
		if (!sp || !res) return null;
		void JSON.stringify(app.sub); void JSON.stringify(app.kh); void JSON.stringify(app.weights);
		const pos = res.positionsAtRun;
		const band: [number, number] = [app.band[0], app.band[1]];
		const [minListenDist, maxListenDist] = app.listenRange;
		return computeScores(sp, sourceGain, app.weights, { khL: pos.khL, khR: pos.khR, listener: pos.listener }, { band, minListenDist, maxListenDist });
	});

	/** valores a mostrar en la capa elegida (0–100, mayor = mejor) */
	const layer = $derived.by(() => {
		if (!scores || !app.spectra) return null;
		const L = app.scoreLayer;
		if (L === 'total') return scores.total;
		const bad = scores.parts[L];
		const out = new Float32Array(bad.length);
		for (let c = 0; c < bad.length; c++) out[c] = Number.isFinite(scores.total[c]) ? 100 * (1 - bad[c]) : NaN;
		return out;
	});

	// la posición actual del oyente se sigue en directo (al arrastrarlo en 3D o con el ratón en el mapa):
	// su respuesta sale de los espectros ya simulados del plano, sin volver a simular
	const current = $derived(scores && app.spectra ? nearestCell(app.spectra, app.positions.listener) : -1);

	/** Curvas de respuesta en directo: tú, bajo el ratón y mejor punto. */
	const live = $derived.by(() => {
		const sp = app.spectra;
		if (!sp || !scores) return null;
		void JSON.stringify(app.sub); void JSON.stringify(app.kh);
		const f = sp.freqs;
		const curves: Curve[] = [];
		const add = (c: number, label: string, color: string, dash = false) => {
			if (c < 0) return;
			curves.push({ label, color, dash, f, db: Array.from(cellResponse(sp, sourceGain, c)) });
		};
		add(current, 'Tú (posición actual)', YOU);
		if (app.hoverCell >= 0 && app.hoverCell < sp.ix.length && app.hoverCell !== current) add(app.hoverCell, 'Bajo el ratón', '#898781');
		if (scores.best >= 0 && scores.best !== current) add(scores.best, 'Mejor punto', BEST, true);
		let lo = Infinity, hi = -Infinity;
		for (const c of curves) for (let k = 0; k < f.length; k++) if (f[k] >= app.band[0] * 0.8) { lo = Math.min(lo, c.db[k]); hi = Math.max(hi, c.db[k]); }
		if (!Number.isFinite(lo)) { lo = -20; hi = 10; }
		const ymax = Math.ceil((hi + 3) / 5) * 5;
		const ymin = Math.min(ymax - 20, Math.floor((lo - 3) / 5) * 5);
		const shade = { f: [Math.max(f[0], app.band[0]), Math.min(f[f.length - 1], app.band[1])], lo: [ymin, ymin], hi: [ymax, ymax], label: 'Rango que cuenta' };
		return { curves, ymin, ymax, shade, xmin: f[0], xmax: f[f.length - 1] };
	});

	// geometría del dibujo del mapa (para pasar del ratón a la celda)
	let view = { s: 1, ox: 0, oy: 0 };
	function cellAtPointer(e: PointerEvent): number {
		const sp = app.spectra;
		if (!sp) return -1;
		const rect = canvas.getBoundingClientRect();
		const gx = (e.clientX - rect.left - view.ox) / view.s, gz = (e.clientY - rect.top - view.oy) / view.s;
		if (gx < 0 || gz < 0 || gx >= sp.nx || gz >= sp.nz) return -1;
		const c = nearestCell(sp, [sp.origin[0] + gx * sp.dx, 0, sp.origin[2] + gz * sp.dx]);
		if (c < 0) return -1;
		return Math.abs(sp.ix[c] + 0.5 - gx) < 1.5 && Math.abs(sp.iz[c] + 0.5 - gz) < 1.5 ? c : -1;
	}
	let dragging = false;
	function moveListenerTo(c: number) {
		const sp = app.spectra!;
		const L = app.positions.listener;
		const r = (v: number) => Math.round(v * 1000) / 1000;
		app.positions.listener = [r(sp.origin[0] + (sp.ix[c] + 0.5) * sp.dx), L[1], r(sp.origin[2] + (sp.iz[c] + 0.5) * sp.dx)];
	}
	function onPointerMove(e: PointerEvent) {
		const c = cellAtPointer(e);
		app.hoverCell = c;
		if (dragging && c >= 0) moveListenerTo(c);
	}
	function onPointerDown(e: PointerEvent) {
		const c = cellAtPointer(e);
		if (c < 0) return;
		dragging = true;
		canvas.setPointerCapture(e.pointerId);
		moveListenerTo(c);
	}
	function onPointerUp() {
		dragging = false;
	}

	const BAND_PRESETS: [string, [number, number]][] = [
		['Hardcore 40–200', [40, 200]],
		['Hasta el sub 30–200', [30, 200]],
		['Todo 20–250', [20, 250]],
		['Solo sub 25–100', [25, 100]]
	];

	$effect(() => {
		if (!canvas || !layer || !scores || !app.spectra) return;
		const sp = app.spectra;
		// imagen a resolución de celda; se amplía sin suavizar para que se vea la densidad de puntos de cada nivel
		const img = document.createElement('canvas');
		img.width = sp.nx;
		img.height = sp.nz;
		const ictx = img.getContext('2d')!;
		let lo = Infinity, hi = -Infinity;
		for (const v of layer) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
		for (let c = 0; c < layer.length; c++) {
			ictx.fillStyle = color(layer[c], lo, hi);
			ictx.fillRect(sp.ix[c], sp.iz[c], 1, 1);
		}
		if (app.resultsTab === 'mejor') {
			mapOverlay.current = { canvas: img, nx: sp.nx, nz: sp.nz, dx: sp.dx, origin: sp.origin, y: app.positions.listener[1] - 0.01 };
		}
		const dpr = window.devicePixelRatio || 1;
		// solo se redimensiona si cambia el tamaño (reasignarlo en cada fotograma es caro)
		if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
			canvas.width = Math.round(cw * dpr);
			canvas.height = Math.round(ch * dpr);
		}
		const ctx = canvas.getContext('2d')!;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, cw, ch);
		const s = Math.min(cw / sp.nx, ch / sp.nz);
		const ox = (cw - s * sp.nx) / 2, oy = (ch - s * sp.nz) / 2;
		view = { s, ox, oy };
		ctx.imageSmoothingEnabled = false;
		ctx.drawImage(img, ox, oy, s * sp.nx, s * sp.nz);
		const toPx = (p: V3) => [ox + ((p[0] - sp.origin[0]) / sp.dx) * s, oy + ((p[2] - sp.origin[2]) / sp.dx) * s];
		const pos = app.result!.positionsAtRun;
		const dot = (p: V3, col: string, lab: string) => {
			const [x, y] = toPx(p);
			ctx.fillStyle = col;
			ctx.beginPath();
			ctx.arc(x, y, 8, 0, Math.PI * 2);
			ctx.fill();
			ctx.fillStyle = '#fff';
			ctx.font = 'bold 11px system-ui';
			ctx.textAlign = 'center';
			ctx.fillText(lab, x, y + 4);
		};
		// el sub suele estar debajo de un KH: se dibuja antes y desplazado para que no lo tape
		if (app.sub.enabled) dot([pos.sub[0] + 0.12, pos.sub[1], pos.sub[2] + 0.12], '#4b4a46', 'S');
		dot(pos.khL, '#2a78d6', 'L');
		dot(pos.khR, '#eb6834', 'R');
		// celda bajo el ratón
		if (app.hoverCell >= 0 && app.hoverCell < sp.ix.length) {
			ctx.strokeStyle = 'rgba(137,135,129,0.9)';
			ctx.lineWidth = 1.5;
			ctx.strokeRect(ox + sp.ix[app.hoverCell] * s, oy + sp.iz[app.hoverCell] * s, s, s);
		}
		// oyente actual
		const [lx, ly] = toPx(app.positions.listener);
		const ring = (x: number, y: number, r: number, col: string, cross = false) => {
			for (const [c, w] of [['rgba(255,255,255,0.95)', 6], [col, 3]] as [string, number][]) {
				ctx.strokeStyle = c;
				ctx.lineWidth = w;
				ctx.beginPath();
				ctx.arc(x, y, r, 0, Math.PI * 2);
				if (cross) {
					ctx.moveTo(x - r - 4, y); ctx.lineTo(x + r + 4, y);
					ctx.moveTo(x, y - r - 4); ctx.lineTo(x, y + r + 4);
				}
				ctx.stroke();
			}
		};
		ring(lx, ly, 9, YOU);
		// mejor punto
		if (scores.best >= 0) {
			const [bx, by] = toPx(scores.bestPos);
			ring(bx, by, 12, BEST, true);
		}
	});

	function moveToBest() {
		if (!scores || scores.best < 0) return;
		const L = app.positions.listener;
		const r = (v: number) => Math.round(v * 1000) / 1000;
		app.positions.listener = [r(scores.bestPos[0]), L[1], r(scores.bestPos[2])];
	}
	const fmt = (v: number, d = 0) => (Number.isFinite(v) ? v.toFixed(d).replace('.', ',') : '—');
	const fmtM = (v: number) => v.toFixed(2).replace('.', ',');
	const sk = (p: V3) => toSketchup(p);
</script>

<div class="grid h-full min-h-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_300px]">
	<div class="flex min-h-0 flex-col">
		<div class="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
			{#if app.level}
				<span class="rounded bg-bg px-1.5 py-0.5 tabular-nums text-ink">Nivel {app.level.i + 1}/{app.level.n} · hasta {app.level.fmax} Hz · rejilla {fmt(app.level.dx * 100)} cm</span>
				<span>{app.level.engine}</span>
			{/if}
			{#if app.running}<span class="text-accent">Afinando…</span>{/if}
		</div>
		<div class="relative min-h-0 flex-1" bind:clientWidth={cw} bind:clientHeight={ch}>
			<canvas bind:this={canvas} style="width:{cw}px;height:{ch}px" class="absolute inset-0 cursor-crosshair touch-none" aria-label="Mapa de la mejor posición de escucha (clic o arrastre para mover el oyente)"
				onpointermove={onPointerMove} onpointerdown={onPointerDown} onpointerup={onPointerUp} onpointerleave={() => { if (!dragging) app.hoverCell = -1; }}></canvas>
		</div>
		<div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted">
			<span>peor de la sala</span>
			<div class="flex h-2 min-w-20 flex-1 overflow-hidden rounded-sm">{#each RAMP as c}<div class="flex-1" style="background:{c}"></div>{/each}</div>
			<span>mejor de la sala</span>
			<span class="ml-3 inline-flex items-center gap-1"><span class="inline-block h-3 w-3 rounded-full border-[3px] border-[#7c4dcc]"></span>tú</span>
			<span class="inline-flex items-center gap-1"><span class="inline-block h-3 w-3 rounded-full border-[3px] border-[#fab219]"></span>mejor punto</span>
			<span class="inline-flex items-center gap-1"><span class="inline-block h-3 w-3 rounded-sm bg-[rgba(137,135,129,0.35)]"></span>no válido (pared, muy cerca o detrás de los KH)</span>
		</div>
	</div>
	<div class="flex min-h-[220px] flex-col">
		{#if live}
			<div class="min-h-0 flex-1">
				<ResponseChart curves={live.curves} band={live.shade} xmin={live.xmin} xmax={live.xmax} ymin={live.ymin} ymax={live.ymax} yLabel="dB (0 = 1 altavoz a 1 m)" />
			</div>
			<p class="mt-1 text-[11px] text-muted">En directo: arrastra el oyente en el mapa o en 3D y la curva cambia al momento (sale de los datos ya simulados). Graves del sistema completo L+R{app.sub.enabled ? '+sub' : ''}, sin suavizar.</p>
		{/if}
	</div>
	<div class="min-h-0 space-y-3 overflow-y-auto text-xs">
		{#if scores && app.spectra}
			<div class="rounded-md border border-line p-2.5">
				<div class="mb-1.5 font-medium text-ink">Qué cuenta</div>
				<div class="flex items-end gap-2">
					<label class="flex-1">Desde (Hz)<input class="input w-full" type="number" min="15" max={app.band[1] - 5} step="5" bind:value={app.band[0]} /></label>
					<label class="flex-1">Hasta (Hz)<input class="input w-full" type="number" min={app.band[0] + 5} max="300" step="10" bind:value={app.band[1]} /></label>
				</div>
				<div class="mt-2 flex flex-wrap gap-1">
					{#each BAND_PRESETS as [lab, b]}
						<button class="rounded border px-1.5 py-0.5 {app.band[0] === b[0] && app.band[1] === b[1] ? 'border-accent text-accent' : 'border-line text-muted hover:text-ink'}" onclick={() => (app.band = [b[0], b[1]])}>{lab}</button>
					{/each}
				</div>
				<div class="mt-2 flex items-end gap-2">
					<label class="flex-1">Escucha desde (m)<input class="input w-full" type="number" min="0.3" max={app.listenRange[1] - 0.1} step="0.1" bind:value={app.listenRange[0]} /></label>
					<label class="flex-1">hasta (m)<input class="input w-full" type="number" min={app.listenRange[0] + 0.1} max="6" step="0.1" bind:value={app.listenRange[1]} /></label>
				</div>
				<p class="mt-1.5 text-muted">Lo que pase fuera de este rango no puntúa. Si tu sub no baja de ~30 Hz y tu música rara vez baja de 40–50 Hz, no tiene sentido sacrificar posición por los 20 Hz. La distancia de escucha (media a los dos KH) limita dónde se busca.{app.level && app.band[1] > 0.8 * app.level.fmax ? ` Ahora mismo solo hay datos hasta ${Math.round(0.8 * app.level.fmax)} Hz (se amplía al afinar).` : ''}</p>
			</div>
			<div class="rounded-md border border-line p-2.5">
				<div class="flex items-baseline justify-between" id="best-score">
					<span class="text-muted">Mejor punto</span>
					<span class="text-lg font-semibold tabular-nums text-ink">{fmt(scores.total[scores.best])}<span class="text-xs font-normal text-muted">/100</span></span>
				</div>
				<div class="tabular-nums text-ink" id="best-pos">X {fmtM(sk(scores.bestPos)[0])} · Y {fmtM(sk(scores.bestPos)[1])} m</div>
				<div class="mt-1 flex items-baseline justify-between">
					<span class="text-muted">Tu posición actual</span>
					<span class="font-semibold tabular-nums text-ink" id="you-score">{current >= 0 ? fmt(scores.total[current]) : '—'}/100</span>
				</div>
				<button class="btn-primary mt-2 w-full" onclick={moveToBest}>Mover el oyente al mejor punto</button>
			</div>
			<label class="block text-ink">Capa del mapa
				<select class="input w-full" bind:value={app.scoreLayer}>
					<option value="total">Puntuación total</option>
					{#each CRITERIA as c}<option value={c.id}>{c.label}</option>{/each}
				</select>
			</label>
			<div class="rounded-md border border-line p-2.5">
				<div class="mb-1.5 flex items-center justify-between">
					<span class="font-medium text-ink">Peso de cada criterio</span>
					<button class="text-accent hover:underline" onclick={() => (app.weights = { ...DEFAULT_WEIGHTS })}>Restablecer</button>
				</div>
				<table class="w-full">
					<thead class="text-muted"><tr><th class="text-left font-medium">Criterio</th><th class="font-medium">Peso</th><th class="text-right font-medium">Mejor</th><th class="text-right font-medium">Tú</th></tr></thead>
					<tbody>
						{#each CRITERIA as c}
							<tr class="border-t border-line text-ink" title={c.help}>
								<td class="py-1 pr-1">{c.label}</td>
								<td class="w-24"><input class="w-full" type="range" min="0" max="3" step="0.1" bind:value={app.weights[c.id as Criterion]} aria-label="Peso de {c.label}" /></td>
								<td class="text-right tabular-nums">{fmt(100 * (1 - scores.parts[c.id][scores.best]))}</td>
								<td class="text-right tabular-nums">{current >= 0 ? fmt(100 * (1 - scores.parts[c.id][current])) : '—'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
				<p class="mt-1.5 text-muted">Cada criterio puntúa de 0 a 100 (mayor = mejor). Pasa el ratón por encima para ver qué mide.</p>
			</div>
			<p class="text-muted">Puntuación de cada posible posición de tu cabeza (a {fmtM(sk(app.positions.listener)[2])} m de altura) con los altavoces donde están ahora. Se calcula con los graves simulados (hasta {app.level?.fmax ?? '—'} Hz) más la geometría; las reflexiones de medios y agudos llegarán en la fase 2. Sirve para comparar sitios, no como valor absoluto.</p>
		{:else}
			<p class="text-muted">{app.running ? 'Calculando la primera vista previa…' : 'Simula para ver el mapa.'}</p>
		{/if}
	</div>
</div>
