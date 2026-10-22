<script lang="ts">
	import { waterfall, decayBands, type Spectrum } from '../dsp/analysis';

	let { sp, fmax }: { sp: Spectrum; fmax: number } = $props();
	const bands = $derived([25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400].filter((b) => b * 1.15 < fmax));
	const dec = $derived(decayBands(sp, bands));
	const wf = $derived(waterfall(sp, 20, fmax * 0.85));

	let canvas: HTMLCanvasElement;
	let cw = $state(500);
	let ch = $state(220);
	const RANGE = 45; // dB de color
	// rampa secuencial azul (claro = bajo nivel, oscuro = alto)
	const ramp = ['#f4f8fd', '#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
	function colorOf(v: number): string {
		const t = Math.max(0, Math.min(1, (v + RANGE) / RANGE));
		return ramp[Math.min(ramp.length - 1, Math.floor(t * ramp.length))];
	}
	const m = { l: 44, r: 8, t: 6, b: 28 };
	$effect(() => {
		if (!canvas) return;
		const dpr = window.devicePixelRatio || 1;
		canvas.width = cw * dpr;
		canvas.height = ch * dpr;
		const ctx = canvas.getContext('2d')!;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, cw, ch);
		const pw = cw - m.l - m.r, ph = ch - m.t - m.b;
		const nT = wf.times.length, nF = wf.freqs.length;
		for (let ti = 0; ti < nT; ti++)
			for (let fi = 0; fi < nF; fi++) {
				ctx.fillStyle = colorOf(wf.rows[ti][fi]);
				ctx.fillRect(m.l + (fi / nF) * pw, m.t + (ti / nT) * ph, pw / nF + 0.6, ph / nT + 0.6);
			}
		const css = getComputedStyle(canvas);
		ctx.fillStyle = css.getPropertyValue('--c-muted') || '#888';
		ctx.font = '10px system-ui';
		ctx.textAlign = 'center';
		const fl = Math.log10(wf.freqs[0]), fh = Math.log10(wf.freqs[nF - 1]);
		for (const f of [20, 30, 40, 50, 60, 80, 100, 150, 200, 300, 400]) {
			if (f < wf.freqs[0] || f > wf.freqs[nF - 1]) continue;
			ctx.fillText(String(f), m.l + ((Math.log10(f) - fl) / (fh - fl)) * pw, ch - m.b + 13);
		}
		ctx.fillText('Frecuencia (Hz)', m.l + pw / 2, ch - 3);
		ctx.textAlign = 'right';
		for (let tms = 0; tms <= wf.times[nT - 1]; tms += 100) ctx.fillText(tms + ' ms', m.l - 4, m.t + (tms / wf.times[nT - 1]) * ph + 4);
	});
	const fmt = (v: number | null) => (v === null ? '—' : v.toFixed(2).replace('.', ','));
</script>

<div class="grid h-full min-h-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
	<div class="flex min-h-0 flex-col">
		<div class="mb-1 flex items-center justify-between text-xs text-muted">
			<span>Cascada de decaimiento en el punto central (eje vertical: tiempo hacia abajo). Las franjas oscuras que bajan mucho son modos que "retumban".</span>
		</div>
		<div class="relative min-h-0 flex-1" bind:clientWidth={cw} bind:clientHeight={ch}>
			<canvas bind:this={canvas} style="width:{cw}px;height:{ch}px" class="absolute inset-0" aria-label="Cascada de decaimiento"></canvas>
		</div>
		<div class="mt-1 flex items-center gap-2 text-[10px] text-muted">
			<span>−{RANGE} dB</span>
			<div class="flex h-2 flex-1 overflow-hidden rounded-sm">{#each ramp as c}<div class="flex-1" style="background:{c}"></div>{/each}</div>
			<span>0 dB</span>
		</div>
	</div>
	<div class="min-h-0 overflow-y-auto">
		<table class="w-full text-xs">
			<thead class="text-muted"><tr><th class="py-1 text-left font-medium">Banda</th><th class="text-right font-medium">EDT</th><th class="text-right font-medium">T20</th><th class="text-right font-medium">T30</th></tr></thead>
			<tbody>
				{#each dec as d}
					<tr class="border-t border-line text-ink">
						<td class="py-1">{d.fc} Hz</td>
						<td class="text-right tabular-nums">{fmt(d.edt)}</td>
						<td class="text-right tabular-nums {d.t20 !== null && d.t20 > 0.5 ? 'font-semibold' : ''}">{fmt(d.t20)}</td>
						<td class="text-right tabular-nums">{fmt(d.t30)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
		<p class="mt-2 text-xs text-muted">Segundos para caer 60 dB, por tercios de octava, en el punto central con el sistema completo. En un estudio, lo deseable en graves es no superar ~0,3–0,5 s y que no haya bandas muy por encima del resto.</p>
	</div>
</div>
