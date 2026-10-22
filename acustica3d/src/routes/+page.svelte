<script lang="ts">
	import Viewer3D from '../lib/components/Viewer3D.svelte';
	import Sidebar from '../lib/components/Sidebar.svelte';
	import Results from '../lib/components/Results.svelte';
	import { app } from '../lib/state.svelte';
	import { runSimulation } from '../lib/sim/controller';
	import { onMount } from 'svelte';

	// Actualizaciones: solo existen cuando la app la sirve Acustica3D.exe (en el navegador o el visor no hay /api)
	type Upd = { current: string; state: string; latest: string; done: number; total: number; message: string };
	let upd = $state<Upd | null>(null);
	let restarting = $state(false);
	onMount(() => {
		let timer: ReturnType<typeof setTimeout>;
		let stop = false;
		// el lanzador sirve la app en 127.0.0.1 / localhost, puertos 8765–8784; en cualquier otro sitio no hay /api
		const port = Number(location.port);
		if (!['localhost', '127.0.0.1'].includes(location.hostname) || port < 8765 || port > 8784) return;
		const poll = async () => {
			try {
				const r = await fetch('/api/update', { cache: 'no-store' });
				if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return;
				upd = await r.json();
			} catch {
				return; // sin lanzador: no hay actualizaciones
			}
			if (stop) return;
			const busy = upd && (upd.state === 'checking' || upd.state === 'downloading' || upd.state === 'idle');
			timer = setTimeout(poll, busy ? 1500 : 10 * 60 * 1000);
		};
		poll();
		return () => {
			stop = true;
			clearTimeout(timer);
		};
	});
	async function restartNow() {
		restarting = true;
		try {
			await fetch('/api/update/restart', { method: 'POST' });
		} catch {
			/* la ventana se cierra sola */
		}
	}

	// Recalcular solo al cambiar algo que afecta a la simulación (con una pequeña espera
	// para no relanzar mientras arrastras). Cada relanzamiento cancela el cálculo anterior.
	// El oyente solo cuenta por su altura: al moverlo en horizontal el mapa ya tiene la respuesta
	// de cada punto, así que no se vuelve a simular (el efecto se reejecuta, pero la clave no cambia).
	let lastKey = '';
	let autoTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const { listener, ...src } = app.positions;
		const key = JSON.stringify([
			src, listener[1], app.objects, app.matMap, app.sub.enabled, app.sim, app.engine, app.modelName
		]);
		if (!app.autoSim || !app.tris || key === lastKey) return;
		lastKey = key;
		clearTimeout(autoTimer);
		autoTimer = setTimeout(() => {
			try {
				runSimulation();
			} catch (e) {
				app.error = e instanceof Error ? e.message : String(e);
			}
		}, 450);
	});
	$effect(() => () => clearTimeout(autoTimer));

	let resultsH = $state(360);
	let dragging = false;
	function startDrag(e: PointerEvent) {
		dragging = true;
		(e.target as HTMLElement).setPointerCapture(e.pointerId);
	}
	function onDrag(e: PointerEvent) {
		if (!dragging) return;
		resultsH = Math.max(160, Math.min(window.innerHeight - 200, window.innerHeight - e.clientY));
	}
	let projInput: HTMLInputElement;
	let projMsg = $state('');
	// Dentro de un visor incrustado (iframe) las descargas están bloqueadas: se copia al portapapeles.
	const embedded = typeof window !== 'undefined' && window.self !== window.top;
	async function copyProject() {
		try {
			await navigator.clipboard.writeText(JSON.stringify(app.exportProject(), null, 1));
			projMsg = 'Proyecto copiado: pégalo en un archivo .json para guardarlo';
		} catch {
			projMsg = 'No se pudo copiar al portapapeles';
		}
	}
	function saveProject() {
		const blob = new Blob([JSON.stringify(app.exportProject(), null, 1)], { type: 'application/json' });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = (app.modelName?.replace(/\.[^.]+$/, '') ?? 'sala') + '.acustica3d.json';
		a.click();
		URL.revokeObjectURL(a.href);
	}
	async function openProject(e: Event) {
		const f = (e.target as HTMLInputElement).files?.[0];
		if (!f) return;
		try {
			app.importProject(JSON.parse(await f.text()));
			projMsg = app.modelName ? 'Proyecto cargado' : 'Ajustes cargados: ahora carga el modelo de SketchUp';
		} catch (err) {
			projMsg = err instanceof Error ? err.message : String(err);
		}
		projInput.value = '';
	}
</script>

<svelte:head><title>Acustica3D</title></svelte:head>

<div class="app-root grid h-full grid-rows-[auto_1fr] bg-bg">
	<header class="gutter flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-panel py-2">
		<h1 class="text-base font-semibold text-ink">Acustica3D</h1>
		<span class="text-xs text-muted">Simulación acústica 3D de la sala · fase 1: graves</span>
		<span class="text-[11px] tabular-nums text-muted" id="app-version">v{upd?.current ?? __APP_VERSION__}</span>
		{#if upd?.state === 'downloading'}
			<span class="text-[11px] text-muted">Descargando la versión {upd.latest}… {upd.total ? Math.round((100 * upd.done) / upd.total) : 0} %</span>
		{:else if upd?.state === 'ready'}
			<span class="flex items-center gap-2 rounded-md bg-accent/10 px-2 py-0.5 text-[11px] text-ink" id="update-ready">
				Versión {upd.latest} lista: se instala al cerrar
				<button class="font-semibold text-accent hover:underline" disabled={restarting} onclick={restartNow}>{restarting ? 'Reiniciando…' : 'Reiniciar ahora'}</button>
			</span>
		{/if}
		<div class="ml-auto flex flex-wrap items-center gap-3 text-xs text-muted">
			{#if projMsg}<span>{projMsg}</span>{/if}
			{#if embedded}
				<button class="btn py-1 text-xs" onclick={copyProject}>Copiar proyecto</button>
			{:else}
				<button class="btn py-1 text-xs" onclick={saveProject}>Guardar proyecto</button>
			{/if}
			<button class="btn py-1 text-xs" onclick={() => projInput.click()}>Abrir proyecto</button>
			<input id="project-file" bind:this={projInput} type="file" accept=".json" class="hidden" onchange={openProject} />
			{#if app.result}<span>Rejilla {(app.result.grid.dx * 100).toFixed(1)} cm · {app.result.grid.airVolume.toFixed(1)} m³ de aire</span>{/if}
		</div>
	</header>
	<div class="layout min-h-0">
		<Sidebar />
		<main class="workspace grid min-h-0 min-w-0" style="--results-h:{resultsH}px">
			<div class="min-h-0 min-w-0"><Viewer3D /></div>
			<div class="cursor-row-resize bg-line hover:bg-accent" role="separator" aria-orientation="horizontal"
				onpointerdown={startDrag} onpointermove={onDrag} onpointerup={() => (dragging = false)}></div>
			<div class="min-h-0 min-w-0"><Results /></div>
		</main>
	</div>
</div>
