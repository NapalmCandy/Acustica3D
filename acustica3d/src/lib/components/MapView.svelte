<script lang="ts">
	import { onDestroy } from 'svelte';
	import { app } from '../state.svelte';
	import { requestMap, sourceGain } from '../sim/controller';
	import { mapOverlay } from '../mapOverlay.svelte';
	import { anim, animData, mapFMax } from '../mapAnim.svelte';

	let canvas: HTMLCanvasElement;
	let cw = $state(500);
	let ch = $state(300);
	let busy = $state(false);
	let info = $state<{ median: number; spreadArea: number } | null>(null);
	/** mapa a una frecuencia suelta (mientras el barrido completo no está listo) */
	let single = $state.raw<{ values: Float32Array; ix: Int32Array; iz: Int32Array; nx: number; nz: number } | null>(null);
	const RANGE = 12; // ± dB respecto a la mediana
	const F_LO = 20;

	// divergente: azul (por debajo) ↔ gris ↔ rojo (por encima)
	const neg = ['#104281', '#256abf', '#5598e7', '#9ec5f4', '#d9e6f5'];
	const pos = ['#f5dcdc', '#ef9f9e', '#e66767', '#d03b3b', '#9d2524'];
	function color(v: number) {
		const t = Math.max(-1, Math.min(1, v / RANGE));
		if (Math.abs(t) < 0.08) return '#f0efec';
		if (t < 0) return neg[Math.min(4, Math.floor((1 + t) * 5))];
		return pos[Math.min(4, Math.floor(t * 5))];
	}
	// tabla de colores (RGB) para pintar píxel a píxel sin crear cadenas en cada fotograma
	const LUT_N = 241;
	const LUT = new Uint8Array(LUT_N * 3);
	for (let i = 0; i < LUT_N; i++) {
		const hex = color(((i / (LUT_N - 1)) * 2 - 1) * RANGE);
		for (let k = 0; k < 3; k++) LUT[i * 3 + k] = parseInt(hex.slice(1 + 2 * k, 3 + 2 * k), 16);
	}

	const fHi = $derived(app.result ? mapFMax(app.result.fmax) : 300);
	const framesReady = $derived(anim.total > 0 && anim.ready === anim.total);

	/** Barrido completo en dB (fotogramas × celdas), mono con altavoces y cruce; con 1/3 oct opcional. */
	const sweep = $derived.by(() => {
		if (!framesReady) return null;
		void JSON.stringify(app.sub); void JSON.stringify(app.kh);
		const { freqs, ids, nCells: nC, re, im } = animData;
		const nF = freqs.length;
		const pow = new Float32Array(nF * nC);
		for (let k = 0; k < nF; k++) {
			const g = ids.map((id) => sourceGain(id, freqs[k], 'mono'));
			for (let c = 0; c < nC; c++) {
				let r = 0, i = 0;
				for (let s = 0; s < ids.length; s++) {
					const o = k * nC + c, hr = re[s][o], hi = im[s][o];
					r += hr * g[s][0] - hi * g[s][1];
					i += hr * g[s][1] + hi * g[s][0];
				}
				pow[k * nC + c] = r * r + i * i;
			}
		}
		// 1/3 de octava = ±8 fotogramas a 1/48 de octava (promedio de potencia)
		const w = app.mapBand ? 8 : 0;
		const db = new Float32Array(nF * nC);
		const median = new Float32Array(nF);
		const tmp = new Float32Array(nC);
		for (let k = 0; k < nF; k++) {
			const a = Math.max(0, k - w), b = Math.min(nF - 1, k + w);
			for (let c = 0; c < nC; c++) {
				let acc = 0;
				for (let j = a; j <= b; j++) acc += pow[j * nC + c];
				const v = 10 * Math.log10(acc / (b - a + 1) + 1e-20);
				db[k * nC + c] = v;
				tmp[c] = v;
			}
			tmp.sort();
			median[k] = tmp[nC >> 1];
		}
		return { db, median, freqs, nC };
	});

	// índice del fotograma (frecuencia) en el barrido
	let frame = $state(0);
	let playing = $state(false);
	let fps = $state(24);
	let loop = $state(true);
	let raf = 0;

	function nearestFrame(f: number) {
		const fr = animData.freqs;
		if (!fr.length) return 0;
		const k = Math.round((Math.log(f / fr[0]) / Math.log(fr[fr.length - 1] / fr[0])) * (fr.length - 1));
		return Math.max(0, Math.min(fr.length - 1, k));
	}

	// al tener el barrido, se coloca en la frecuencia actual
	$effect(() => {
		if (framesReady) frame = nearestFrame(Math.min(app.mapFreq, fHi));
	});

	function play() {
		if (!sweep) return;
		if (frame >= sweep.freqs.length - 1) frame = 0;
		playing = true;
		let last = performance.now();
		let acc = 0;
		const tick = (now: number) => {
			if (!playing || !sweep) return;
			acc += ((now - last) / 1000) * fps;
			last = now;
			const step = Math.floor(acc);
			if (step > 0) {
				acc -= step;
				let f = frame + step;
				if (f >= sweep.freqs.length) {
					if (loop) f = 0;
					else {
						f = sweep.freqs.length - 1;
						playing = false;
					}
				}
				frame = f;
				app.mapFreq = sweep.freqs[f];
			}
			if (playing) raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
	}
	function pause() {
		playing = false;
		cancelAnimationFrame(raf);
	}
	onDestroy(pause);

	// sin barrido todavía: cálculo de una frecuencia suelta en el worker
	async function computeSingle() {
		if (!app.result?.plane) return;
		busy = true;
		const m = await requestMap(app.mapFreq, app.mapBand);
		single = { values: m.values, ix: m.ix, iz: m.iz, nx: m.nx, nz: m.nz };
		busy = false;
	}
	$effect(() => {
		void app.mapFreq; void app.mapBand; void app.result; void JSON.stringify(app.sub); void JSON.stringify(app.kh);
		if (framesReady) return;
		const t = setTimeout(computeSingle, 120);
		return () => clearTimeout(t);
	});

	// imagen a resolución de celda, reutilizada en cada fotograma (también para la vista 3D)
	const img = typeof document !== 'undefined' ? document.createElement('canvas') : (null as unknown as HTMLCanvasElement);

	$effect(() => {
		if (!canvas || !app.result?.plane) return;
		const pl = app.result.plane;
		let values: Float32Array, ix: Int32Array, iz: Int32Array, nx: number, nz: number, median: number;
		if (sweep) {
			const k = Math.min(frame, sweep.freqs.length - 1);
			values = sweep.db.subarray(k * sweep.nC, (k + 1) * sweep.nC);
			({ ix, iz, nx, nz } = animData);
			median = sweep.median[k];
		} else if (single) {
			({ values, ix, iz, nx, nz } = single);
			const sorted = Array.from(values).sort((a, b) => a - b);
			median = sorted[Math.floor(sorted.length / 2)];
		} else return;
		if (img.width !== nx || img.height !== nz) {
			img.width = nx;
			img.height = nz;
		}
		const ictx = img.getContext('2d')!;
		const im = ictx.createImageData(nx, nz);
		const px = im.data;
		for (let c = 0; c < values.length; c++) {
			const t = Math.max(-1, Math.min(1, (values[c] - median) / RANGE));
			const l = Math.round(((t + 1) / 2) * (LUT_N - 1)) * 3;
			const o = (iz[c] * nx + ix[c]) * 4;
			px[o] = LUT[l];
			px[o + 1] = LUT[l + 1];
			px[o + 2] = LUT[l + 2];
			px[o + 3] = 255;
		}
		ictx.putImageData(im, 0, 0);
		mapOverlay.current = { canvas: img, nx, nz, dx: pl.dx, origin: pl.origin, y: app.positions.listener[1] - 0.01 };
		// variación dentro de la zona de escucha
		const L = app.positions.listener, h = app.sim.areaHalf;
		let lo = Infinity, hi = -Infinity;
		for (let c = 0; c < values.length; c++) {
			const x = pl.origin[0] + (ix[c] + 0.5) * pl.dx, z = pl.origin[2] + (iz[c] + 0.5) * pl.dx;
			if (Math.abs(x - L[0]) <= h && Math.abs(z - L[2]) <= h) {
				lo = Math.min(lo, values[c]);
				hi = Math.max(hi, values[c]);
			}
		}
		info = { median, spreadArea: Number.isFinite(lo) ? hi - lo : 0 };
		// dibujo escalado, vista en planta (X →, fondo ↓ como en SketchUp visto desde arriba)
		const dpr = window.devicePixelRatio || 1;
		// solo se redimensiona si cambia el tamaño (reasignarlo en cada fotograma es caro)
		if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
			canvas.width = Math.round(cw * dpr);
			canvas.height = Math.round(ch * dpr);
		}
		const ctx = canvas.getContext('2d')!;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, cw, ch);
		const s = Math.min(cw / nx, ch / nz);
		const ox = (cw - s * nx) / 2, oy = (ch - s * nz) / 2;
		ctx.imageSmoothingEnabled = false;
		ctx.drawImage(img, ox, oy, s * nx, s * nz);
		const toPx = (p: [number, number, number]) => [ox + ((p[0] - pl.origin[0]) / pl.dx) * s, oy + ((p[2] - pl.origin[2]) / pl.dx) * s];
		const marks: [string, [number, number, number], string][] = [
			...(app.sub.enabled ? ([['S', [app.positions.sub[0] + 0.12, 0, app.positions.sub[2] + 0.12], '#4b4a46']] as [string, [number, number, number], string][]) : []),
			['L', app.positions.khL, '#2a78d6'], ['R', app.positions.khR, '#eb6834'],
			['●', app.positions.listener, '#1baf7a']
		];
		ctx.font = 'bold 11px system-ui';
		ctx.textAlign = 'center';
		for (const [lab, p, col] of marks) {
			const [x, y] = toPx(p);
			ctx.fillStyle = col;
			ctx.beginPath();
			ctx.arc(x, y, 8, 0, Math.PI * 2);
			ctx.fill();
			ctx.fillStyle = '#fff';
			ctx.fillText(lab === '●' ? '' : lab, x, y + 4);
		}
		const [lx, ly] = toPx([L[0] - h, 0, L[2] - h]);
		ctx.strokeStyle = '#1baf7a';
		ctx.lineWidth = 2;
		ctx.strokeRect(lx, ly, 2 * h * (s / pl.dx), 2 * h * (s / pl.dx));
	});

	const shownFreq = $derived(sweep ? sweep.freqs[Math.min(frame, sweep.freqs.length - 1)] : app.mapFreq);
	function onSlider(e: Event) {
		const v = Math.pow(10, parseFloat((e.target as HTMLInputElement).value));
		app.mapFreq = v;
		if (framesReady) frame = nearestFrame(v);
	}
	const fmt0 = (f: number) => (f < 100 ? f.toFixed(1).replace('.', ',') : f.toFixed(0));
</script>

<div class="grid h-full min-h-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
	<div class="relative min-h-0" bind:clientWidth={cw} bind:clientHeight={ch}>
		<canvas bind:this={canvas} style="width:{cw}px;height:{ch}px" class="absolute inset-0" aria-label="Mapa de nivel en el plano de escucha"></canvas>
		<div class="pointer-events-none absolute left-2 top-2 rounded bg-panel/90 px-2 py-1 text-sm font-semibold tabular-nums text-ink" id="map-freq">{fmt0(shownFreq)} Hz</div>
		{#if busy && !framesReady}<div class="absolute right-2 top-2 rounded bg-panel px-2 py-1 text-xs text-muted">Calculando…</div>{/if}
	</div>
	<div class="min-h-0 space-y-3 overflow-y-auto text-xs">
		<div class="flex items-center gap-2">
			{#if playing}
				<button class="btn-primary w-24" onclick={pause}>❚❚ Pausa</button>
			{:else}
				<button class="btn-primary w-24" disabled={!framesReady} onclick={play}>▶ Play</button>
			{/if}
			<label class="flex items-center gap-1.5 text-ink">Velocidad
				<select class="input py-0.5" bind:value={fps}>
					<option value={12}>lenta</option><option value={24}>normal</option><option value={48}>rápida</option>
				</select>
			</label>
			<label class="flex items-center gap-1.5 text-ink"><input type="checkbox" bind:checked={loop} /> Bucle</label>
		</div>
		{#if !framesReady}
			<div>
				<div class="h-1.5 overflow-hidden rounded-full bg-line"><div class="h-full bg-accent transition-[width]" style="width:{anim.total ? (100 * anim.ready) / anim.total : 0}%"></div></div>
				<p class="mt-1 text-muted">
					{#if app.running}Esperando a que termine la simulación para preparar la animación…{:else if anim.total}Preparando la animación: {Math.round((100 * anim.ready) / anim.total)} %{:else}Preparando la animación…{/if}
				</p>
			</div>
		{/if}
		<label class="block text-ink">Frecuencia ({F_LO}–{Math.round(fHi)} Hz)
			<input class="w-full" type="range" min={Math.log10(F_LO)} max={Math.log10(fHi)} step="0.002"
				value={Math.log10(shownFreq)} oninput={onSlider} aria-label="Frecuencia del mapa" />
		</label>
		{#if fHi < 299}
			<p class="rounded-md bg-[#fab219]/15 px-2 py-1.5 text-ink">Con la frecuencia máxima de simulación en {app.result?.fmax} Hz el mapa llega hasta {Math.round(fHi)} Hz. Para llegar a 300 Hz, ponla en 350 Hz o más (en «5 · Simulación»).</p>
		{/if}
		<label class="flex items-center gap-2 text-ink"><input type="checkbox" bind:checked={app.mapBand} /> Promediar 1/3 de octava</label>
		<label class="flex items-center gap-2 text-ink"><input type="checkbox" bind:checked={app.view.showMap} /> Mostrar en la vista 3D</label>
		<div>
			<div class="flex h-2.5 overflow-hidden rounded-sm">
				{#each [...neg, '#f0efec', ...pos] as c}<div class="flex-1" style="background:{c}"></div>{/each}
			</div>
			<div class="mt-0.5 flex justify-between text-[10px] text-muted"><span>−{RANGE} dB</span><span>mediana</span><span>+{RANGE} dB</span></div>
		</div>
		{#if info}
			<p class="text-ink">Variación dentro de tu zona de escucha (±{app.sim.areaHalf.toFixed(2).replace('.', ',')} m): <strong>{info.spreadArea.toFixed(1).replace('.', ',')} dB</strong></p>
		{/if}
		<p class="text-muted">Nivel a la altura de tus oídos con ambos KH y el sub (reproducción mono), relativo a la mediana de la sala en cada frecuencia. Azul: hueco; rojo: acumulación. Con Play se recorre de {F_LO} a {Math.round(fHi)} Hz y se ven aparecer los modos de la sala.</p>
		<p class="text-muted">Vista en planta como en SketchUp desde arriba: X hacia la derecha, Y hacia arriba.</p>
	</div>
</div>
