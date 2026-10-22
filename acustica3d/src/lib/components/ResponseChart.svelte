<script lang="ts" module>
	export interface Curve {
		label: string;
		color: string;
		f: number[];
		db: number[];
		dash?: boolean;
	}
</script>

<script lang="ts">
	interface Props {
		curves: Curve[];
		band?: { f: number[]; lo: number[]; hi: number[]; label: string } | null;
		xmin: number;
		xmax: number;
		ymin?: number;
		ymax?: number;
		yLabel?: string;
	}
	let { curves, band = null, xmin, xmax, ymin = -30, ymax = 20, yLabel = 'Nivel (dB)' }: Props = $props();

	let w = $state(600);
	let h = $state(280);
	const m = { l: 48, r: 14, t: 10, b: 32 };
	const X = (f: number) => m.l + ((Math.log10(f) - Math.log10(xmin)) / (Math.log10(xmax) - Math.log10(xmin))) * (w - m.l - m.r);
	const Y = (d: number) => m.t + ((ymax - Math.max(ymin, Math.min(ymax, d))) / (ymax - ymin)) * (h - m.t - m.b);
	const path = (f: number[], d: number[]) =>
		f.map((ff, i) => (ff >= xmin && ff <= xmax ? `${i === 0 || f[i - 1] < xmin ? 'M' : 'L'}${X(ff).toFixed(1)},${Y(d[i]).toFixed(1)}` : '')).join('');
	const xticks = $derived([10, 20, 30, 40, 50, 60, 80, 100, 150, 200, 300, 400, 500].filter((t) => t >= xmin && t <= xmax));
	const yticks = $derived.by(() => {
		const out: number[] = [];
		for (let v = Math.ceil(ymin / 5) * 5; v <= ymax; v += 5) out.push(v);
		return out;
	});
	let hoverF = $state<number | null>(null);
	function onMove(e: PointerEvent) {
		const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
		const x = e.clientX - rect.left;
		if (x < m.l || x > w - m.r) return (hoverF = null);
		hoverF = Math.pow(10, Math.log10(xmin) + ((x - m.l) / (w - m.l - m.r)) * (Math.log10(xmax) - Math.log10(xmin)));
	}
	const valueAt = (c: Curve, f: number) => {
		let i = c.f.findIndex((ff) => ff >= f);
		if (i <= 0) i = 1;
		const t = (f - c.f[i - 1]) / (c.f[i] - c.f[i - 1]);
		return c.db[i - 1] + t * (c.db[i] - c.db[i - 1]);
	};
</script>

<div class="flex h-full w-full flex-col">
	<div class="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
		{#each curves as c}
			<span class="flex items-center gap-1.5">
				<svg width="18" height="6" aria-hidden="true"><line x1="0" y1="3" x2="18" y2="3" stroke={c.color} stroke-width="2" stroke-dasharray={c.dash ? '4 3' : ''} /></svg>
				{c.label}
			</span>
		{/each}
		{#if band}
			<span class="flex items-center gap-1.5"><span class="inline-block h-2.5 w-4 rounded-sm" style="background:rgba(42,120,214,0.16)"></span>{band.label}</span>
		{/if}
	</div>
	<div class="relative min-h-0 flex-1" bind:clientWidth={w} bind:clientHeight={h}>
		<svg width={w} height={h} class="absolute inset-0" role="img" aria-label="Respuesta en frecuencia" onpointermove={onMove} onpointerleave={() => (hoverF = null)}>
			{#each yticks as t}
				<line x1={m.l} x2={w - m.r} y1={Y(t)} y2={Y(t)} stroke="var(--c-grid)" stroke-width={t === 0 ? 1.2 : 0.7} />
				<text x={m.l - 6} y={Y(t) + 3.5} text-anchor="end" font-size="10" fill="var(--c-muted)">{t}</text>
			{/each}
			{#each xticks as t}
				<line x1={X(t)} x2={X(t)} y1={m.t} y2={h - m.b} stroke="var(--c-grid)" stroke-width="0.7" />
				<text x={X(t)} y={h - m.b + 14} text-anchor="middle" font-size="10" fill="var(--c-muted)">{t}</text>
			{/each}
			<text x={(m.l + w - m.r) / 2} y={h - 3} text-anchor="middle" font-size="10" fill="var(--c-muted)">Frecuencia (Hz)</text>
			<text transform="translate(11,{(m.t + h - m.b) / 2}) rotate(-90)" text-anchor="middle" font-size="10" fill="var(--c-muted)">{yLabel}</text>
			{#if band}
				<path
					d={band.f.map((f, i) => `${i ? 'L' : 'M'}${X(f).toFixed(1)},${Y(band.hi[i]).toFixed(1)}`).join('') +
						band.f.slice().reverse().map((f, i) => `L${X(f).toFixed(1)},${Y(band.lo[band.lo.length - 1 - i]).toFixed(1)}`).join('') + 'Z'}
					fill="rgba(42,120,214,0.16)"
				/>
			{/if}
			{#each curves as c}
				<path d={path(c.f, c.db)} fill="none" stroke={c.color} stroke-width="2" stroke-dasharray={c.dash ? '5 4' : ''} stroke-linejoin="round" />
			{/each}
			{#if hoverF}
				<line x1={X(hoverF)} x2={X(hoverF)} y1={m.t} y2={h - m.b} stroke="var(--c-muted)" stroke-width="1" />
			{/if}
		</svg>
		{#if hoverF}
			<div class="pointer-events-none absolute top-2 rounded-md border border-line bg-panel px-2 py-1.5 text-xs shadow-md"
				style="left:{Math.min(X(hoverF) + 10, w - 170)}px">
				<div class="font-semibold text-ink">{hoverF.toFixed(1)} Hz</div>
				{#each curves as c}
					<div class="flex items-center gap-1.5 text-ink"><span class="inline-block h-2 w-2 rounded-full" style="background:{c.color}"></span>{c.label}: {valueAt(c, hoverF).toFixed(1)} dB</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
