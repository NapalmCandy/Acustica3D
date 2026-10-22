<script lang="ts">
	import { app, toSketchup, fromSketchup, type DeviceId } from '../state.svelte';
	import { LIBRARY, OCTAVES } from '../acoustics/materials';
	import { importFile, objectFromTris } from '../geometry/importer';
	import { demoRoom, DEMO_POSITIONS } from '../sim/testgeo';
	import { runSimulation, cancelSimulation, placeTriangle, autoPlace } from '../sim/controller';
	import { mapOverlay } from '../mapOverlay.svelte';
	import type { V3 } from '../sim/voxel';
	import { PRESETS } from '../geometry/objects';

	let fileInput: HTMLInputElement;
	let loading = $state(false);
	let loadError = $state<string | null>(null);
	let triDist = $state(1.2);
	let triHeight = $state(1.2);
	let open = $state<Record<string, boolean>>({ modelo: true, materiales: true, equipos: true, objetos: true, sim: true, ayuda: false });

	const DEVICES: { id: DeviceId; label: string }[] = [
		{ id: 'listener', label: 'Oyente (tu cabeza)' },
		{ id: 'khL', label: 'KH 120 A izquierdo' },
		{ id: 'khR', label: 'KH 120 A derecho' },
		{ id: 'sub', label: 'ADAM Sub8' }
	];

	async function onFile(e: Event) {
		const f = (e.target as HTMLInputElement).files?.[0];
		if (!f) return;
		loading = true;
		loadError = null;
		try {
			const m = await importFile(f);
			app.setModel(m.fileName, m.object, m.tris, m.materialNames, m.warnings, { min: m.bbox.min, max: m.bbox.max });
			mapOverlay.current = null;
			autoPlace();
		} catch (err) {
			loadError = err instanceof Error ? err.message : String(err);
		} finally {
			loading = false;
			fileInput.value = '';
		}
	}

	function loadDemo() {
		const nt = demoRoom();
		const mats = [...new Set(nt.materials)].sort();
		const libColor = (m: string) => '#cccccc';
		const obj = objectFromTris(nt, libColor);
		let mn: V3 = [Infinity, Infinity, Infinity], mx: V3 = [-Infinity, -Infinity, -Infinity];
		for (let i = 0; i < nt.positions.length; i += 3)
			for (let k = 0; k < 3; k++) {
				mn[k] = Math.min(mn[k], nt.positions[i + k]);
				mx[k] = Math.max(mx[k], nt.positions[i + k]);
			}
		app.setModel('Sala de ejemplo (4,2 × 3,6 × 2,6 m)', obj, nt, mats, [], { min: mn, max: mx });
		app.positions = JSON.parse(JSON.stringify(DEMO_POSITIONS));
		mapOverlay.current = null;
	}

	function skCoord(id: DeviceId, k: number): number {
		return Math.round(toSketchup(app.positions[id])[k] * 1000) / 1000;
	}
	function setSkCoord(id: DeviceId, k: number, v: number) {
		if (!Number.isFinite(v)) return;
		const sk = toSketchup(app.positions[id]);
		sk[k] = v;
		app.positions[id] = fromSketchup(sk);
	}

	const est = $derived.by(() => {
		void app.sim.fmax; void app.sim.ppw; void app.sim.durationS; void app.sub.enabled; void app.bbox;
		return app.estimate();
	});
	const fmt = (v: number, d = 2) => v.toLocaleString('es-ES', { maximumFractionDigits: d, minimumFractionDigits: d });
	const dims = $derived(app.bbox ? [0, 1, 2].map((k) => app.bbox!.max[k] - app.bbox!.min[k]) : null);
</script>

{#snippet section(key: string, title: string, body: import('svelte').Snippet)}
	<section class="border-b border-line">
		<button
			class="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-ink hover:bg-bg"
			onclick={() => (open[key] = !open[key])}
			aria-expanded={open[key]}
		>
			{title}
			<span class="text-muted">{open[key] ? '−' : '+'}</span>
		</button>
		{#if open[key]}<div class="space-y-3 px-4 pb-4 text-sm">{@render body()}</div>{/if}
	</section>
{/snippet}

{#snippet modelo()}
	<div class="flex flex-wrap gap-2">
		<button class="btn-primary" onclick={() => fileInput.click()} disabled={loading}>
			{loading ? 'Cargando…' : 'Cargar modelo de SketchUp (.skp)'}
		</button>
		<button class="btn" onclick={loadDemo}>Sala de ejemplo</button>
		<input id="model-file" bind:this={fileInput} type="file" accept=".skp,.dae,.obj,.glb,.gltf" class="hidden" onchange={onFile} />
	</div>
	{#if loadError}<p class="rounded-md bg-red-500/10 px-3 py-2 text-red-700 dark:text-red-300">⚠ {loadError}</p>{/if}
	{#if app.modelName}
		<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
			<dt class="text-muted">Archivo</dt><dd class="truncate text-ink">{app.modelName}</dd>
			{#if dims}<dt class="text-muted">Tamaño total</dt><dd class="text-ink">{fmt(dims[0])} × {fmt(dims[2])} × {fmt(dims[1])} m (ancho × fondo × alto)</dd>{/if}
			<dt class="text-muted">Triángulos</dt><dd class="text-ink">{app.tris?.materials.length.toLocaleString('es-ES')}</dd>
			<dt class="text-muted">Materiales</dt><dd class="text-ink">{app.materialNames.length}</dd>
		</dl>
		{#each app.warnings as w}<p class="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">⚠ {w}</p>{/each}
	{/if}
	<details class="text-xs text-muted">
		<summary class="cursor-pointer">Cómo preparar el modelo en SketchUp</summary>
		<ol class="mt-2 list-decimal space-y-1 pl-4">
			<li>Pon un material con nombre claro a cada superficie importante (p. ej. <em>Pladur</em>, <em>Falso_techo</em>, <em>Suelo_tarima</em>, <em>Ventana</em>, <em>Puerta</em>, <em>Panel_LR_50mm</em>, <em>Escritorio</em>).</li>
			<li>Guarda y carga aquí el <strong>.skp</strong> tal cual (SketchUp 2021 o posterior). Lo que esté oculto o en etiquetas ocultas no se importa.</li>
			<li>La sala debe estar cerrada (puertas y ventanas como caras, no huecos).</li>
			<li>También sirve exportarlo como <em>COLLADA (.dae)</em>, <em>.obj</em> o <em>.glb</em>.</li>
		</ol>
	</details>
{/snippet}

{#snippet materiales()}
	{#if !app.materialNames.length}
		<p class="text-muted">Carga un modelo para asignar materiales.</p>
	{:else}
		<p class="text-xs text-muted">Asigna a cada material de SketchUp su comportamiento acústico. Los valores son típicos de tablas; se calibrarán con medidas.</p>
		<ul class="space-y-3">
			{#each app.materialNames as m (m)}
				{@const a = app.matMap[m]}
				{@const lib = LIBRARY.find((l) => l.id === a?.libId)}
				{@const alpha = app.alphaOf(m)}
				<li class="rounded-md border border-line p-2.5">
					<div class="mb-1.5 flex items-center gap-2">
						<span class="h-3 w-3 shrink-0 rounded-sm" style="background:{lib?.color}"></span>
						<span class="truncate font-medium text-ink" title={m}>{m}</span>
					</div>
					<select class="input w-full" bind:value={app.matMap[m].libId}
						onchange={() => { const l = LIBRARY.find((x) => x.id === app.matMap[m].libId); if (l?.porous && !app.matMap[m].porous) app.matMap[m].porous = { ...l.porous }; }}>
						{#each LIBRARY as l}<option value={l.id}>{l.name}</option>{/each}
					</select>
					{#if lib?.kind === 'porous' && a.porous}
						<div class="mt-2 grid grid-cols-3 gap-2 text-xs">
							<label>Grosor (mm)<input class="input w-full" type="number" min="10" max="400" bind:value={a.porous.thickness_mm} /></label>
							<label>Densidad (kg/m³)<input class="input w-full" type="number" min="20" max="150" bind:value={a.porous.density_kgm3} /></label>
							<label>Cámara (mm)<input class="input w-full" type="number" min="0" max="400" bind:value={a.porous.airgap_mm} /></label>
						</div>
					{/if}
					{#if lib?.kind !== 'ignore'}
						<div class="mt-2 flex items-end gap-0.5" aria-label="Absorción por octavas">
							{#each alpha as v, i}
								<div class="flex flex-1 flex-col items-center">
									<div class="w-full rounded-t-sm bg-accent" style="height:{Math.max(2, v * 28)}px" title="{OCTAVES[i]} Hz: α = {v.toFixed(2)}"></div>
									<span class="mt-0.5 text-[9px] text-muted">{OCTAVES[i] >= 1000 ? OCTAVES[i] / 1000 + 'k' : OCTAVES[i]}</span>
								</div>
							{/each}
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
{/snippet}

{#snippet equipos()}
	<p class="text-xs text-muted">Coordenadas como en SketchUp: X ancho, Y fondo, Z altura (m). También puedes hacer clic en un equipo de la vista 3D y arrastrarlo.</p>
	{#each DEVICES as d}
		<div class="rounded-md border p-2.5 {app.selected === d.id ? 'border-accent' : 'border-line'}">
			<div class="mb-1.5 flex items-center justify-between">
				<span class="font-medium text-ink">{d.label}</span>
				<button class="text-xs text-accent hover:underline" onclick={() => (app.selected = app.selected === d.id ? null : d.id)}>
					{app.selected === d.id ? 'Soltar' : 'Mover en 3D'}
				</button>
			</div>
			<div class="grid grid-cols-3 gap-2 text-xs">
				{#each ['X', 'Y', 'Z'] as axis, k}
					<label>{axis}<input class="input w-full" type="number" step="0.01" value={skCoord(d.id, k)} onchange={(e) => setSkCoord(d.id, k, parseFloat((e.target as HTMLInputElement).value))} /></label>
				{/each}
			</div>
		</div>
	{/each}
	<div class="rounded-md border border-line p-2.5">
		<div class="mb-1.5 font-medium text-ink">Triángulo equilátero</div>
		<div class="grid grid-cols-2 gap-2 text-xs">
			<label>Distancia (m)<input class="input w-full" type="number" step="0.05" min="0.6" max="3" bind:value={triDist} /></label>
			<label>Altura tweeter (m)<input class="input w-full" type="number" step="0.05" bind:value={triHeight} /></label>
		</div>
		<button class="btn mt-2 w-full" onclick={() => placeTriangle(triDist, (app.bbox?.min[1] ?? 0) + triHeight)}>Colocar los KH respecto al oyente</button>
	</div>
	<div class="rounded-md border border-line p-2.5 text-xs">
		<div class="mb-1.5 text-sm font-medium text-ink">Sub8 y cruce <span class="text-muted">(filtros estimados)</span></div>
		<label class="flex items-center gap-2"><input type="checkbox" bind:checked={app.sub.enabled} /> Sub8 activo</label>
		<label class="mt-1 flex items-center gap-2"><input type="checkbox" bind:checked={app.kh.satHpf85} /> Filtro de 85 Hz en los KH (salidas a satélites)</label>
		<div class="mt-2 grid grid-cols-2 gap-2">
			<label>Corte del sub (Hz)<input class="input w-full" type="number" min="50" max="150" step="1" bind:value={app.sub.xoverHz} /></label>
			<label>Nivel del sub (dB)<input class="input w-full" type="number" min="-20" max="10" step="0.5" bind:value={app.sub.gainDb} /></label>
			<label>Retardo extra (ms)<input class="input w-full" type="number" min="-20" max="20" step="0.1" bind:value={app.sub.extraDelayMs} /></label>
			<label class="flex items-end gap-2 pb-1"><input type="checkbox" bind:checked={app.sub.polarityInvert} /> Fase 180°</label>
		</div>
		<p class="mt-2 text-muted">El cruce y la fase se aplican al instante sin volver a simular. Mover equipos sí requiere simular otra vez.</p>
	</div>
{/snippet}

{#snippet sim()}
	<div class="grid grid-cols-2 gap-2 text-xs">
		<label>Frecuencia máxima
			<select class="input w-full" bind:value={app.sim.fmax}>
				{#each [150, 200, 300, 350, 400, 500] as f}<option value={f}>{f} Hz</option>{/each}
			</select>
		</label>
		<label>Duración (s)<input class="input w-full" type="number" min="0.5" max="4" step="0.25" bind:value={app.sim.durationS} /></label>
		<label>Zona de escucha (± m)<input class="input w-full" type="number" min="0.05" max="0.6" step="0.05" bind:value={app.sim.areaHalf} /></label>
		<label>Puntos por longitud de onda<input class="input w-full" type="number" min="6" max="16" step="1" bind:value={app.sim.ppw} /></label>
	</div>
	{#if est}
		<p class="text-xs text-muted">Rejilla de {fmt(est.dx * 100, 1)} cm · ~{Math.round(est.cells / 1000).toLocaleString('es-ES')} mil celdas · {Math.round(est.steps).toLocaleString('es-ES')} pasos por fuente · estimado ≈ {est.seconds < 60 ? Math.ceil(est.seconds) + ' s' : Math.ceil(est.seconds / 60) + ' min'}</p>
	{/if}
	<div class="grid grid-cols-2 gap-2 text-xs">
		<label class="flex items-center gap-2 text-ink"><input type="checkbox" bind:checked={app.autoSim} /> Recalcular al mover algo</label>
		<label>Motor
			<select class="input w-full" bind:value={app.engine}>
				<option value="auto">Automático (recomendado)</option>
				<option value="gpu">Forzar GPU</option>
				<option value="cpu">Solo procesador</option>
			</select>
		</label>
	</div>
	{#if app.running}
		<div class="space-y-1.5">
			<div class="h-2 overflow-hidden rounded-full bg-line"><div class="h-full bg-accent transition-[width]" style="width:{app.progress.frac * 100}%"></div></div>
			<p class="text-xs text-muted">{app.progress.stage}</p>
			<button class="btn w-full" onclick={cancelSimulation}>Detener</button>
		</div>
	{:else}
		<button class="btn-primary w-full" disabled={!app.tris} onclick={() => { try { runSimulation(); } catch (e) { app.error = e instanceof Error ? e.message : String(e); } }}>Simular ahora</button>
		{#if app.progress.stage}<p class="text-xs text-muted">{app.progress.stage}</p>{/if}
	{/if}
	{#if app.level}<p class="text-xs text-muted">Motor: {app.level.engine}</p>{/if}
	<p class="text-xs text-muted">Primero sale una vista previa rápida (hasta 100 Hz) y se va afinando por niveles hasta la frecuencia máxima. Si mueves algo, vuelve a empezar.</p>
	{#if app.error}<p class="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">⚠ {app.error}</p>{/if}
	{#if app.result?.grid.leak}
		<p class="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
			⚠ La sala no está cerrada: el aire "se escapa" cerca de
			({toSketchup(app.result.grid.leakPoint!).map((v) => fmt(v)).join(', ')}) m. Se ha tratado como una abertura absorbente. Cierra puertas y ventanas en el modelo.
		</p>
	{/if}
	<p class="text-xs text-muted">Simulación de ondas en 3D (FDTD) de los graves. Por encima de la frecuencia máxima no se calcula.</p>
{/snippet}

{#snippet objetos()}
	<p class="text-xs text-muted">Añade paneles, trampas de graves o muebles y muévelos en la vista 3D: el mapa se recalcula solo.</p>
	<div class="grid grid-cols-2 gap-2">
		{#each PRESETS as pr}<button class="btn text-xs" disabled={!app.tris} onclick={() => app.addObject(pr.key)}>+ {pr.label}</button>{/each}
	</div>
	{#each app.objects as o (o.id)}
		{@const lib = LIBRARY.find((l) => l.id === o.libId)}
		<div class="rounded-md border p-2.5 text-xs {app.selected === `obj:${o.id}` ? 'border-accent' : 'border-line'}">
			<div class="mb-1.5 flex items-center gap-2">
				<span class="h-3 w-3 shrink-0 rounded-sm" style="background:{lib?.color}"></span>
				<input class="input min-w-0 flex-1 py-0.5" bind:value={o.name} aria-label="Nombre del objeto" />
				<button class="text-accent hover:underline" onclick={() => (app.selected = app.selected === `obj:${o.id}` ? null : `obj:${o.id}`)}>{app.selected === `obj:${o.id}` ? 'Soltar' : 'Mover'}</button>
				<button class="text-red-600 hover:underline dark:text-red-400" onclick={() => app.removeObject(o.id)}>Quitar</button>
			</div>
			<div class="grid grid-cols-3 gap-2">
				<label>Ancho (m)<input class="input w-full" type="number" step="0.05" min="0.02" bind:value={o.size[0]} /></label>
				<label>Alto (m)<input class="input w-full" type="number" step="0.05" min="0.02" bind:value={o.size[1]} /></label>
				<label>Fondo (m)<input class="input w-full" type="number" step="0.01" min="0.02" bind:value={o.size[2]} /></label>
			</div>
			<div class="mt-2 flex items-end gap-2">
				<label class="min-w-0 flex-1">Material
					<select class="input w-full" bind:value={o.libId} onchange={() => { const l = LIBRARY.find((x) => x.id === o.libId); if (l?.porous && !o.porous) o.porous = { ...l.porous }; }}>
						{#each LIBRARY.filter((l) => l.kind !== 'ignore') as l}<option value={l.id}>{l.name}</option>{/each}
					</select>
				</label>
				<button class="btn px-2 py-1 text-xs" onclick={() => (o.rotY = (o.rotY + 90) % 360)} title="Girar 90°">Girar 90°</button>
			</div>
			{#if lib?.kind === 'porous' && o.porous}
				<div class="mt-2 grid grid-cols-3 gap-2">
					<label>Grosor (mm)<input class="input w-full" type="number" min="10" max="600" bind:value={o.porous.thickness_mm} /></label>
					<label>Densidad<input class="input w-full" type="number" min="20" max="150" bind:value={o.porous.density_kgm3} /></label>
					<label>Cámara (mm)<input class="input w-full" type="number" min="0" max="400" bind:value={o.porous.airgap_mm} /></label>
				</div>
			{/if}
		</div>
	{/each}
{/snippet}

<aside class="h-full overflow-y-auto border-r border-line bg-panel">
	{@render section('modelo', '1 · Modelo de la sala', modelo)}
	{@render section('materiales', '2 · Materiales', materiales)}
	{@render section('equipos', '3 · Altavoces y oyente', equipos)}
	{@render section('objetos', '4 · Objetos y paneles', objetos)}
	{@render section('sim', '5 · Simulación', sim)}
</aside>
