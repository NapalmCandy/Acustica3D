<script lang="ts">
	import { app } from '../state.svelte';
	import { systemSpectrum, sourceGain } from '../sim/controller';
	import { magnitudeCurve, combine } from '../dsp/analysis';
	import { OCTAVES } from '../acoustics/materials';
	import ResponseChart, { type Curve } from './ResponseChart.svelte';
	import DecayView from './DecayView.svelte';
	import MapView from './MapView.svelte';
	import BestSpotView from './BestSpotView.svelte';
	import OptimizeView from './OptimizeView.svelte';

	const TABS = [
		['mejor', 'Mejor posición'],
		['colocar', 'Colocación automática'],
		['respuesta', 'Respuesta'],
		['decaimiento', 'Decaimiento'],
		['mapa', 'Mapa de la sala'],
		['materiales', 'Superficies y reverberación']
	] as const;

	let showNoSub = $state(false);
	let showSub = $state(true);

	const res = $derived(app.result);
	const fLo = 20;
	const fHi = $derived(res ? res.fmax * 0.85 : 300);

	const resp = $derived.by(() => {
		if (!res) return null;
		void JSON.stringify(app.sub); void JSON.stringify(app.kh);
		const frac = app.smoothing;
		const curve = (ch: 'L' | 'R' | 'mono', rcv = 0, withSub = true) => magnitudeCurve(systemSpectrum(res, rcv, ch, withSub), fLo, fHi, 48, frac);
		// normalización: mono → nivel medio 0 dB entre 80 y 200 Hz (relativo, para leer desviaciones)
		const mono = curve('mono');
		const ref = (() => {
			const v = mono.db.filter((_, i) => mono.f[i] >= 80 && mono.f[i] <= Math.min(200, fHi));
			return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
		})();
		const norm = (c: { f: number[]; db: number[] }) => ({ f: c.f, db: c.db.map((d) => d - ref) });
		const L = norm(curve('L'));
		const R = norm(curve('R'));
		const M = norm(mono);
		// banda espacial (todos los receptores, mono)
		const all = res.receivers.map((_, r) => norm(curve('mono', r)));
		const lo = M.f.map((_, i) => Math.min(...all.map((a) => a.db[i])));
		const hi = M.f.map((_, i) => Math.max(...all.map((a) => a.db[i])));
		const curves: Curve[] = [
			{ label: 'Mono (L+R+sub), punto central', color: '#1baf7a', ...M },
			{ label: 'Solo canal izquierdo', color: '#2a78d6', ...L },
			{ label: 'Solo canal derecho', color: '#eb6834', ...R }
		];
		if (showNoSub && app.sub.enabled) curves.push({ label: 'Mono sin sub', color: '#898781', dash: true, ...norm(curve('mono', 0, false)) });
		// el sub solo (con su cruce, nivel, fase y retardo), en el mismo punto y con la misma referencia
		if (showSub && app.sub.enabled && res.tf.sub) {
			const subOnly = combine([{ tf: res.tf.sub[0], spk: (f: number) => sourceGain('sub', f, 'mono') }]);
			curves.push({ label: 'Solo sub (con su cruce)', color: '#a0522d', ...norm(magnitudeCurve(subOnly, fLo, fHi, 48, frac)) });
		}
		// métricas
		const inBand = (f: number) => f >= 30 && f <= fHi;
		const mb = M.db.filter((_, i) => inBand(M.f[i]));
		const spread = mb.length ? Math.max(...mb) - Math.min(...mb) : 0;
		const varSpatial = M.f.map((_, i) => hi[i] - lo[i]).filter((_, i) => inBand(M.f[i]));
		const meanSpatial = varSpatial.reduce((a, b) => a + b, 0) / Math.max(1, varSpatial.length);
		let worstDip = { f: 0, db: 0 }, worstPeak = { f: 0, db: 0 };
		M.f.forEach((f, i) => {
			if (!inBand(f)) return;
			if (M.db[i] < worstDip.db) worstDip = { f, db: M.db[i] };
			if (M.db[i] > worstPeak.db) worstPeak = { f, db: M.db[i] };
		});
		return { curves, band: { f: M.f, lo, hi, label: `Variación en la zona de escucha (${res.receivers.length} puntos)` }, spread, meanSpatial, worstDip, worstPeak };
	});

	const centerSpectrum = $derived.by(() => {
		if (!res) return null;
		void JSON.stringify(app.sub); void JSON.stringify(app.kh);
		return systemSpectrum(res, 0, 'mono');
	});

	// Reverberación estadística (Eyring) con las superficies que tocan el aire de la sala
	const eyring = $derived.by(() => {
		if (!res) return null;
		const V = res.grid.airVolume;
		const rows = [...res.areaByMat.entries()].filter(([n]) => n !== '(exterior/otros)');
		const S = rows.reduce((s, [, a]) => s + a, 0);
		// el área de una rejilla en escalera sobreestima las superficies inclinadas; aceptable aquí
		const air = [0, 0, 0, 0.0003, 0.001, 0.0024, 0.0059, 0.021]; // m (4m) por octava, 20 °C 50 %HR aprox.
		const T = OCTAVES.map((_, b) => {
			const A = rows.reduce((s, [n, a]) => s + a * app.alphaOf(n)[b], 0);
			const am = Math.min(0.99, A / S);
			return (0.161 * V) / (-S * Math.log(1 - am) + 4 * air[b] * V);
		});
		return { V, S, rows, T };
	});
	const moved = $derived.by(() => {
		if (!res) return false;
		const a = res.positionsAtRun.listener, b = app.positions.listener;
		return Math.hypot(a[0] - b[0], a[2] - b[2]) > 0.05;
	});
	const fmt = (v: number, d = 1) => v.toFixed(d).replace('.', ',');
</script>

<div class="flex h-full min-h-0 flex-col bg-panel">
	<div class="flex items-center gap-1 overflow-x-auto border-b border-line px-3" role="tablist">
		{#each TABS as [id, label]}
			<button role="tab" aria-selected={app.resultsTab === id}
				class="-mb-px border-b-2 px-3 py-2 text-sm {app.resultsTab === id ? 'border-accent font-semibold text-ink' : 'border-transparent text-muted hover:text-ink'}"
				onclick={() => (app.resultsTab = id)}>{label}</button>
		{/each}
		{#if app.resultsTab === 'respuesta' && res}
			<div class="ml-auto flex items-center gap-3 text-xs text-muted">
				<label class="flex items-center gap-1.5">Suavizado
					<select class="input py-0.5" bind:value={app.smoothing}>
						<option value={0}>ninguno</option><option value={24}>1/24 oct</option><option value={12}>1/12 oct</option><option value={6}>1/6 oct</option><option value={3}>1/3 oct</option>
					</select>
				</label>
				{#if app.sub.enabled}
					<label class="flex items-center gap-1.5"><input type="checkbox" bind:checked={showSub} /> Sub solo</label>
					<label class="flex items-center gap-1.5"><input type="checkbox" bind:checked={showNoSub} /> Comparar sin sub</label>
				{/if}
			</div>
		{/if}
	</div>
	<div class="min-h-0 flex-1 p-3">
		{#if app.resultsTab === 'colocar'}
			<OptimizeView />
		{:else if !res}
			<div class="flex h-full items-center justify-center text-sm text-muted">
				{app.running ? 'Calculando la primera vista previa…' : app.tris ? 'Pulsa «Simular» para ver los resultados.' : 'Carga tu modelo de SketchUp o prueba la sala de ejemplo.'}
			</div>
		{:else if app.resultsTab === 'mejor'}
			<BestSpotView />
		{:else if app.resultsTab === 'respuesta' && resp}
			{#if moved}
				<p class="mb-2 rounded-md bg-[#fab219]/15 px-3 py-1.5 text-xs text-ink">Has movido el oyente desde la última simulación: esta curva es la del punto anterior. La del punto nuevo la tienes al instante en «Mejor posición»; para el detalle completo pulsa «Simular ahora».</p>
			{/if}
			<div class="grid h-full min-h-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
				<ResponseChart curves={resp.curves} band={resp.band} xmin={app.band[0]} xmax={Math.max(app.band[1], app.band[0] * 1.5)} noDataFrom={fHi < app.band[1] ? fHi : null} ymin={-30} ymax={15} yLabel="Nivel relativo (dB)" />
				<div class="space-y-2 overflow-y-auto text-xs">
					<div class="rounded-md border border-line p-2.5">
						<div class="text-muted">Desviación del grave (30–{Math.round(fHi)} Hz), punto central</div>
						<div class="text-lg font-semibold text-ink">{fmt(resp.spread)} dB <span class="text-xs font-normal text-muted">de pico a valle</span></div>
					</div>
					<div class="rounded-md border border-line p-2.5">
						<div class="text-muted">Variación media entre puntos de la zona de escucha</div>
						<div class="text-lg font-semibold text-ink">{fmt(resp.meanSpatial)} dB</div>
					</div>
					<div class="rounded-md border border-line p-2.5">
						<div class="text-muted">Pico más alto / hueco más profundo</div>
						<div class="text-ink"><strong>+{fmt(resp.worstPeak.db)} dB</strong> a {Math.round(resp.worstPeak.f)} Hz (se puede recortar con DSP)</div>
						<div class="text-ink"><strong>{fmt(resp.worstDip.db)} dB</strong> a {Math.round(resp.worstDip.f)} Hz (no se corrige con DSP: colocación o tratamiento)</div>
					</div>
					<p class="text-muted">0 dB = nivel medio entre 80 y 200 Hz. Simulación de graves; por encima de {Math.round(fHi)} Hz no es válida.</p>
				</div>
			</div>
		{:else if app.resultsTab === 'decaimiento' && centerSpectrum}
			<DecayView sp={centerSpectrum} fmax={res.fmax} />
		{:else if app.resultsTab === 'mapa'}
			{#if res.plane}<MapView />{:else}<p class="text-sm text-muted">Sin datos de mapa.</p>{/if}
		{:else if app.resultsTab === 'materiales' && eyring}
			<div class="grid h-full min-h-0 grid-cols-1 gap-4 overflow-y-auto lg:grid-cols-2">
				<div>
					<table class="w-full text-xs">
						<thead class="text-muted"><tr><th class="py-1 text-left font-medium">Material (SketchUp)</th><th class="text-right font-medium">Superficie</th></tr></thead>
						<tbody>
							{#each eyring.rows.toSorted((a, b) => b[1] - a[1]) as [n, a]}
								<tr class="border-t border-line text-ink"><td class="py-1">{n}</td><td class="text-right tabular-nums">{fmt(a)} m²</td></tr>
							{/each}
						</tbody>
					</table>
					<p class="mt-2 text-xs text-muted">Volumen de aire: <strong class="text-ink">{fmt(eyring.V)} m³</strong>. Superficie interior total: {fmt(eyring.S)} m² (contada sobre la rejilla).</p>
				</div>
				<div>
					<table class="w-full text-xs">
						<thead class="text-muted"><tr><th class="py-1 text-left font-medium">Octava</th>{#each OCTAVES as f}<th class="text-right font-medium">{f >= 1000 ? f / 1000 + 'k' : f}</th>{/each}</tr></thead>
						<tbody><tr class="border-t border-line text-ink"><td class="py-1">T (s)</td>{#each eyring.T as t}<td class="text-right tabular-nums {t > 0.45 ? 'font-semibold' : ''}">{fmt(t, 2)}</td>{/each}</tr></tbody>
					</table>
					<p class="mt-2 text-xs text-muted">Tiempo de reverberación estadístico (Eyring) con los materiales asignados, en toda la banda. Supone sonido difuso: en graves manda la simulación de ondas (pestaña «Decaimiento»). Objetivo orientativo para un estudio de este tamaño: unos 0,2–0,4 s y parecido en todas las octavas. Las reflexiones tempranas y los puntos para los paneles llegarán en la fase 2.</p>
				</div>
			</div>
		{/if}
	</div>
</div>
