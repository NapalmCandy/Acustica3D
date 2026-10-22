<script lang="ts">
	import { app, toSketchup } from '../state.svelte';
	import { runOptimize, cancelOptimize, applyConfig } from '../sim/controller';
	import { scoreColor, SCORE_RAMP, YOU_COLOR, BEST_COLOR } from '../colors';
	import { CRITERIA } from '../analysis/score';
	import type { OptConfig } from '../sim/optimize';
	import type { V3 } from '../sim/voxel';

	let canvas: HTMLCanvasElement;
	let cw = $state(500);
	let ch = $state(300);
	let selected = $state(0);

	const opt = $derived(app.opt);
	const shown = $derived<OptConfig | null>(opt.top[Math.min(selected, opt.top.length - 1)] ?? null);

	$effect(() => {
		const fp = opt.footprint;
		if (!canvas || !fp) return;
		const dpr = window.devicePixelRatio || 1;
		if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
			canvas.width = Math.round(cw * dpr);
			canvas.height = Math.round(ch * dpr);
		}
		const ctx = canvas.getContext('2d')!;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, cw, ch);
		const s = Math.min(cw / fp.nx, ch / fp.nz);
		const ox = (cw - s * fp.nx) / 2, oy = (ch - s * fp.nz) / 2;
		// planta de la sala a la altura de los oídos
		const dark = matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light';
		for (let z = 0; z < fp.nz; z++)
			for (let x = 0; x < fp.nx; x++) {
				ctx.fillStyle = fp.mask[z * fp.nx + x] ? (dark ? '#2a2927' : '#f4f3ef') : (dark ? '#4b4a46' : '#c9c7c0');
				ctx.fillRect(ox + x * s, oy + z * s, s + 0.5, s + 0.5);
			}
		const toPx = (p: V3) => [ox + ((p[0] - fp.origin[0]) / fp.dx) * s, oy + ((p[2] - fp.origin[2]) / fp.dx) * s];
		// posiciones de escucha probadas (rojo peor → verde mejor)
		let lo = Infinity, hi = -Infinity;
		for (const t of opt.tested) { lo = Math.min(lo, t.score); hi = Math.max(hi, t.score); }
		for (const t of opt.tested) {
			const [x, y] = toPx(t.pos);
			ctx.fillStyle = scoreColor(t.score, lo, hi);
			ctx.strokeStyle = 'rgba(0,0,0,0.35)';
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.arc(x, y, 6, 0, Math.PI * 2);
			ctx.fill();
			ctx.stroke();
		}
		const box = (p: V3, col: string, lab: string, size = 9) => {
			const [x, y] = toPx(p);
			ctx.fillStyle = col;
			ctx.fillRect(x - size, y - size, 2 * size, 2 * size);
			ctx.fillStyle = '#fff';
			ctx.font = 'bold 11px system-ui';
			ctx.textAlign = 'center';
			ctx.fillText(lab, x, y + 4);
		};
		const drawConfig = (c: OptConfig, alpha: number, dashed: boolean) => {
			ctx.globalAlpha = alpha;
			const [lx, ly] = toPx(c.listener);
			ctx.strokeStyle = dark ? '#d0cec8' : '#3b3a36';
			ctx.lineWidth = 1.5;
			ctx.setLineDash(dashed ? [4, 4] : []);
			ctx.beginPath();
			const [ax, ay] = toPx(c.khL), [bx, by] = toPx(c.khR);
			ctx.moveTo(lx, ly); ctx.lineTo(ax, ay); ctx.lineTo(bx, by); ctx.closePath();
			ctx.stroke();
			ctx.setLineDash([]);
			if (c.sub) box(c.sub, '#4b4a46', 'S', 10);
			box(c.khL, '#2a78d6', 'L');
			box(c.khR, '#eb6834', 'R');
			ctx.fillStyle = YOU_COLOR;
			ctx.beginPath();
			ctx.arc(lx, ly, 8, 0, Math.PI * 2);
			ctx.fill();
			ctx.strokeStyle = '#fff';
			ctx.lineWidth = 2;
			ctx.stroke();
			ctx.globalAlpha = 1;
		};
		// tu colocación actual (tenue, discontinua) y la combinación elegida
		if (opt.current) drawConfig(opt.current, 0.45, true);
		if (shown) drawConfig(shown, 1, false);
		// posición que se está probando ahora
		if (opt.testing) {
			const [x, y] = toPx(opt.testing);
			ctx.strokeStyle = BEST_COLOR;
			ctx.lineWidth = 3;
			ctx.beginPath();
			ctx.arc(x, y, 11, 0, Math.PI * 2);
			ctx.stroke();
		}
	});

	const fmt = (v: number, d = 0) => (Number.isFinite(v) ? v.toFixed(d).replace('.', ',') : '—');
	const sk = (p: V3) => { const q = toSketchup(p); return `${fmt(q[0], 2)} · ${fmt(q[1], 2)}`; };
	/** hacia dónde mira el oyente, en ejes de SketchUp (0° = hacia +Y) */
	const facingLabel = (deg: number) => {
		const d = ((Math.round(deg) % 360) + 360) % 360;
		return ({ 0: 'hacia +Y', 90: 'hacia +X', 180: 'hacia −Y', 270: 'hacia −X' } as Record<number, string>)[d] ?? `${d}°`;
	};
	const pct = $derived(opt.total ? Math.min(100, (100 * (opt.done + (opt.running ? opt.frac : 0))) / opt.total) : 0);
	const start = () => {
		selected = 0;
		try {
			runOptimize();
		} catch (e) {
			app.opt = { ...app.opt, error: e instanceof Error ? e.message : String(e) };
		}
	};
</script>

<div class="grid h-full min-h-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
	<div class="flex min-h-[220px] flex-col">
		<div class="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
			{#if opt.running}
				<span class="text-ink">{opt.phase} · posición {Math.min(opt.done + 1, opt.total)} de ~{opt.total}</span>
			{:else if opt.elapsedS !== null}
				<span class="text-ink">Terminado en {fmt(opt.elapsedS)} s · {opt.tested.length} posiciones de escucha probadas</span>
			{/if}
			{#if opt.engine}<span>{opt.engine}</span>{/if}
		</div>
		{#if opt.running || opt.total}
			<div class="mb-2 h-1.5 overflow-hidden rounded-full bg-line"><div class="h-full bg-accent transition-[width]" style="width:{pct}%"></div></div>
		{/if}
		<div class="relative min-h-0 flex-1" bind:clientWidth={cw} bind:clientHeight={ch}>
			<canvas bind:this={canvas} style="width:{cw}px;height:{ch}px" class="absolute inset-0" aria-label="Planta con las posiciones probadas y la mejor colocación"></canvas>
			{#if !opt.footprint}
				<div class="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-muted">
					{opt.running ? 'Preparando la sala…' : 'Pulsa «Buscar la mejor colocación» para que pruebe combinaciones de oyente, KH y sub en tu sala.'}
				</div>
			{/if}
		</div>
		{#if opt.footprint}
			<div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted">
				<span>peor</span>
				<div class="flex h-2 w-24 overflow-hidden rounded-sm">{#each SCORE_RAMP as c}<div class="flex-1" style="background:{c}"></div>{/each}</div>
				<span>mejor (cada punto: el mejor resultado con la cabeza ahí)</span>
				<span class="inline-flex items-center gap-1"><span class="inline-block h-3 w-3 rounded-full" style="background:{YOU_COLOR}"></span>oyente</span>
				<span class="inline-flex items-center gap-1"><span class="inline-block h-3 w-3 rounded-full border-[3px]" style="border-color:{BEST_COLOR}"></span>probando ahora</span>
				<span>discontinuo: tu colocación actual</span>
			</div>
		{/if}
	</div>
	<div class="min-h-0 space-y-3 overflow-y-auto text-xs">
		<div class="rounded-md border border-line p-2.5">
			<div class="grid grid-cols-3 gap-2">
				<label>Orientación
					<select class="input w-full" bind:value={app.optOptions.facings} disabled={opt.running}>
						<option value="todas">Probar las 4</option><option value="actual">Solo la actual</option>
					</select>
				</label>
				<label>Sub
					<select class="input w-full" bind:value={app.optOptions.sub} disabled={opt.running || !app.sub.enabled}>
						<option value="cualquiera">En cualquier sitio</option><option value="cerca">A ≤ 1,5 m de los KH</option>
					</select>
				</label>
				<label>Precisión
					<select class="input w-full" bind:value={app.optOptions.precision} disabled={opt.running}>
						<option value="rapida">Rápida</option><option value="normal">Normal</option><option value="fina">Fina (lenta)</option>
					</select>
				</label>
			</div>
			<div class="mt-2 flex gap-2">
				{#if opt.running}
					<button class="btn flex-1" onclick={cancelOptimize}>Detener</button>
				{:else}
					<button class="btn-primary flex-1" disabled={!app.tris} onclick={start}>Buscar la mejor colocación</button>
				{/if}
			</div>
			<p class="mt-1.5 text-muted">
				Prueba posiciones de tu cabeza por toda la sala; para cada una, los KH en triángulo equilátero a {fmt(Math.max(0.8, app.listenRange[0]), 1)}–{fmt(Math.min(2, app.listenRange[1]), 1)} m, {app.optOptions.facings === 'todas' ? 'mirando hacia cada pared' : 'con tu orientación actual'}{app.sub.enabled ? ', el sub en cada punto del suelo y su fase 0°/180°' : ''}.
				Puntúa con el rango de frecuencias ({app.band[0]}–{app.band[1]} Hz) y los pesos de «Mejor posición». Las paredes, el escritorio y los objetos se respetan.
			</p>
			{#if opt.error}<p class="mt-1 rounded bg-red-500/10 px-2 py-1 text-red-700 dark:text-red-300">{opt.error}</p>{/if}
		</div>

		{#if opt.top.length}
			<table class="w-full" id="opt-top">
				<thead class="text-muted"><tr>
					<th class="text-left font-medium">#</th><th class="text-right font-medium">Punt.</th><th class="pl-2 text-left font-medium">Oyente X · Y (m)</th>
					<th class="text-left font-medium">Mira</th><th class="text-right font-medium">Dist.</th><th class="pl-2 text-left font-medium">Sub</th><th></th>
				</tr></thead>
				<tbody>
					{#each opt.top as c, i}
						<tr class="cursor-pointer border-t border-line text-ink {i === selected ? 'bg-accent/10' : ''}" onclick={() => (selected = i)}>
							<td class="py-1">{i + 1}</td>
							<td class="text-right font-semibold tabular-nums">{fmt(c.score)}</td>
							<td class="pl-2 tabular-nums">{sk(c.listener)}</td>
							<td>{facingLabel(c.facing)}</td>
							<td class="text-right tabular-nums">{fmt(c.dist, 1)} m</td>
							<td class="pl-2 tabular-nums">{c.sub ? `${sk(c.sub)}${c.subInvert ? ' · 180°' : ''}` : '—'}</td>
							<td class="text-right"><button class="text-accent hover:underline" onclick={(e) => { e.stopPropagation(); applyConfig(c); }}>Aplicar</button></td>
						</tr>
					{/each}
					{#if opt.current}
						<tr class="border-t border-line text-muted">
							<td class="py-1">tú</td>
							<td class="text-right font-semibold tabular-nums" id="opt-current">{fmt(opt.current.score)}</td>
							<td class="pl-2 tabular-nums">{sk(opt.current.listener)}</td>
							<td colspan="4">colocación actual</td>
						</tr>
					{/if}
				</tbody>
			</table>
			{#if shown}
				<div class="rounded-md border border-line p-2.5">
					<div class="mb-1 font-medium text-ink">Por qué puntúa así la opción {selected + 1} (0–100, mayor = mejor)</div>
					<div class="grid grid-cols-2 gap-x-4 gap-y-0.5">
						{#each CRITERIA.filter((k) => shown.parts[k.id] !== undefined) as k}
							<div class="flex justify-between" title={k.help}><span class="text-muted">{k.label}</span><span class="tabular-nums text-ink">{fmt(100 * (1 - (shown.parts[k.id] ?? 0)))}{opt.current?.parts[k.id] !== undefined ? ` (tú ${fmt(100 * (1 - (opt.current.parts[k.id] ?? 0)))})` : ''}</span></div>
						{/each}
					</div>
					<p class="mt-1.5 text-muted">KH a {fmt(shown.dist, 1)} m de la cabeza, a la altura actual de los KH. «Aplicar» mueve los equipos y el oyente y vuelve a simular para ver el mapa completo.</p>
				</div>
			{/if}
		{/if}
		<p class="text-muted">Usa la reciprocidad: una simulación con la fuente en tu cabeza da a la vez la respuesta de todas las posiciones posibles de los altavoces. Primero recorre la sala con una rejilla gruesa y luego afina alrededor de los mejores sitios. La robustez al mover la cabeza no entra aquí; compruébala en «Mejor posición» después de aplicar.</p>
	</div>
</div>
