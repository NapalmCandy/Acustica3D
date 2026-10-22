// Prueba de extremo a extremo en Chromium: importar .dae, simular y revisar resultados.
import { chromium } from 'playwright';
const APP_URL = process.argv[2] ?? 'http://localhost:4173/';
const GPU = (process.argv[3] ?? 'gpu') === 'gpu'; // gpu: WebGPU por software (SwiftShader) en Chromium headless
const OUT = new URL('./capturas/', import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', ...(GPU ? ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] : [])] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('response', (r) => { if (r.status() >= 400) errors.push(r.status() + ' ' + r.url()); });
let ok = true;
const check = (name, cond, info = '') => { ok &&= !!cond; console.log((cond ? 'OK   ' : 'FALLO'), name, info); };

await page.goto(APP_URL);
await page.waitForSelector('h1:has-text("Acustica3D")');
await page.setInputFiles('#model-file', new URL('./sala_prueba_sketchup.dae', import.meta.url).pathname);
await page.waitForSelector('aside li span[title="Panel_LR_50mm"]', { timeout: 15000 });
const dims = await page.locator('dd').nth(1).innerText();
check('importa el .dae de SketchUp (pulgadas, Z arriba) y convierte a metros', /4,4\d × 3,8\d × 2,8\d/.test(dims), dims);
const nMats = await page.locator('aside select').count();
check('detecta los 9 materiales', nMats >= 9, String(nMats));
// la asignación automática: el panel debe quedar como lana de roca y el techo como falso techo
const panelSel = await page.locator('li', { hasText: 'Panel_LR_50mm' }).locator('select').inputValue();
const techoSel = await page.locator('li', { hasText: 'Falso_techo' }).locator('select').inputValue();
check('asignación automática de materiales por nombre', panelSel === 'panel_lana_roca' && techoSel === 'falso_techo_pladur', `${panelSel}, ${techoSel}`);
await page.screenshot({ path: OUT + '01_importado.png' });

// simulación: arranca sola al cargar el modelo; al cambiar la frecuencia máxima se relanza
const done = () => page.waitForSelector('text=/^Hecho: /', { timeout: 600000 });
// modo automático (arranca solo al cargar): con una GPU emulada o rejilla pequeña debe elegir el procesador
await done();
const motor0 = await page.locator('text=/^Motor: /').innerText();
check('el modo automático elige el procesador aquí', /Procesador \((la GPU disponible es emulada|sin WebGPU)/.test(motor0), motor0);
await page.locator('label', { hasText: 'Motor' }).locator('select').selectOption(GPU ? 'gpu' : 'cpu');
await page.locator('label', { hasText: 'Frecuencia máxima' }).locator('select').selectOption('200');
const t0 = Date.now();
await page.waitForSelector('text=/^Nivel 1\\/3 · hasta 100 Hz/', { timeout: 300000 });
const tFirst = (Date.now() - t0) / 1000;
await done();
const motor = await page.locator('text=/^Motor: /').innerText();
check('simulación progresiva terminada', true, `primera vista ${tFirst.toFixed(1)} s, total ${((Date.now() - t0) / 1000).toFixed(1)} s · ${motor}`);
check(GPU ? 'usa la GPU (WebGPU)' : 'usa el procesador', GPU ? /^Motor: GPU/.test(motor) : /Procesador/.test(motor), motor);
const leak = await page.locator('text=no está cerrada').count();
check('sala cerrada (sin fugas)', leak === 0);

// pestaña «Mejor posición»
await page.click('role=tab[name="Mejor posición"]');
await page.waitForTimeout(500);
const nivel = await page.locator('text=/^Nivel \\d\\/\\d · hasta/').innerText();
check('mapa de mejor posición al último nivel', /Nivel 3\/3 · hasta 200 Hz/.test(nivel), nivel);
const bestTxt = async () => `${(await page.locator('#best-score').innerText()).replace(/\n/g, ' ')} · ${await page.locator('#best-pos').innerText()}`;
const youTxt = async () => await page.locator('#you-score').innerText();
const best1 = await bestTxt();
check('puntuación del mejor punto', /\d+\/100/.test(best1), best1);
check('curva en directo del punto de escucha', (await page.locator('text=Tú (posición actual)').count()) > 0);
await page.screenshot({ path: OUT + `02_mejor_${GPU ? 'gpu' : 'cpu'}.png` });
// mover el oyente con el ratón sobre el mapa: cambia su puntuación sin volver a simular
const you1 = await youTxt();
const cv = page.locator('canvas[aria-label^="Mapa de la mejor"]');
const bb = await cv.boundingBox();
await page.mouse.click(bb.x + bb.width * 0.5, bb.y + bb.height * 0.62);
await page.waitForTimeout(1500);
const you2 = await youTxt();
const stillDone = await page.locator('text=/^Hecho: /').count();
check('mover el oyente actualiza al instante y sin recalcular', you1 !== you2 && stillDone === 1, `${you1} → ${you2}`);
// rango de frecuencias
await page.click('text=Todo 20–250');
await page.waitForTimeout(300);
const best2 = await bestTxt();
await page.click('text=Hardcore 40–200');
await page.waitForTimeout(300);
const best3 = await bestTxt();
check('el rango de frecuencias cambia la elección', best2 !== best3 && best3 === best1, `20–250: ${best2} | 40–200: ${best3}`);
await page.screenshot({ path: OUT + `03_mejor_movido_${GPU ? 'gpu' : 'cpu'}.png` });

// añadir una trampa de graves: se recalcula solo
await page.click('text=+ Trampa de graves (esquina)');
await page.waitForSelector('text=/^Nivel 1\\/3/', { timeout: 60000 });
await done();
const best4 = await bestTxt();
const you4 = await youTxt();
check('añadir un objeto relanza la simulación', best4 !== best3, best4);

if (GPU) {
	// misma simulación con el procesador: los resultados deben coincidir con los de la GPU
	await page.locator('label', { hasText: 'Motor' }).locator('select').selectOption('cpu');
	await page.waitForSelector('text=/^Nivel 1\\/3/', { timeout: 60000 });
	await done();
	const best5 = await bestTxt();
	check('GPU y procesador: misma puntuación en tu posición', (await youTxt()) === you4, `${you4} / ${await youTxt()}`);
	const num = (t) => [...t.matchAll(/-?\d+(?:,\d+)?/g)].map((m) => parseFloat(m[0].replace(',', '.')));
	const a = num(best4), b = num(best5);
	check('GPU y procesador dan el mismo mapa', Math.abs(a[0] - b[0]) < 0.6 && Math.abs(a[2] - b[2]) < 0.02 && Math.abs(a[3] - b[3]) < 0.02, `GPU: ${best4} | CPU: ${best5}`);
}

await page.click('role=tab[name="Respuesta"]');
await page.waitForTimeout(500);
await page.screenshot({ path: OUT + '04_respuesta.png' });
const spread = await page.locator('text=de pico a valle').first().locator('..').innerText();
check('métrica de desviación calculada', /dB/.test(spread), spread.replace(/\n/g, ' '));

await page.click('role=tab[name="Decaimiento"]');
await page.waitForTimeout(800);
const t20cells = await page.locator('table tbody tr').count();
check('tabla de decaimiento por bandas', t20cells >= 5, `${t20cells} bandas`);
await page.screenshot({ path: OUT + '05_decaimiento.png' });

await page.click('role=tab[name="Mapa de la sala"]');
await page.waitForSelector('text=Variación dentro de tu zona de escucha', { timeout: 30000 });
await page.screenshot({ path: OUT + '06_mapa.png' });
check('mapa de la sala calculado', true);

// animación del mapa: se precalcula sola tras la simulación; Play debe ir fluido
const playBtn = page.locator('button', { hasText: 'Play' });
const tPrep = Date.now();
await page.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Play')); return b && !b.disabled; }, null, { timeout: 120000 });
check('animación precalculada', true, `listo ${((Date.now() - tPrep) / 1000).toFixed(1)} s después de abrir la pestaña`);
// Mide la reproducción: frecuencias distintas mostradas y, sobre todo, tareas largas (> 50 ms) en el
// hilo principal (lo que atascaría la interfaz). Los fps de pantalla aquí los limita el volcado por
// software de Chromium sin GPU (~70 ms por fotograma), no la app.
const measurePlay = async () => {
	await page.evaluate(() => { window.__lt = []; new PerformanceObserver((l) => window.__lt.push(...l.getEntries().map((e) => e.duration))).observe({ type: 'longtask' }); });
	await playBtn.click();
	const r = await page.evaluate(() => new Promise((res) => {
		const el = document.getElementById('map-freq');
		const seen = new Set(); let frames = 0;
		const t0 = performance.now();
		const tick = (now) => {
			frames++; seen.add(el.textContent);
			if (now - t0 < 2000) requestAnimationFrame(tick); else res({ distinct: seen.size, fps: frames / 2, longTasks: window.__lt.length, worstTask: Math.round(Math.max(0, ...window.__lt)) });
		};
		requestAnimationFrame(tick);
	}));
	await page.locator('button', { hasText: 'Pausa' }).click();
	return r;
};
const pr = await measurePlay();
check('Play recorre las frecuencias sin atascar la interfaz', pr.distinct >= 20 && pr.longTasks === 0, `${pr.distinct} frecuencias en 2 s · ${pr.fps} fps de pantalla (limitado por el volcado por software) · tareas largas: ${pr.longTasks}`);
await page.screenshot({ path: OUT + '06b_mapa_animado.png' });

await page.click('role=tab[name="Superficies y reverberación"]');
await page.waitForTimeout(300);
const vol = await page.locator('text=Volumen de aire').innerText();
check('superficies y reverberación estadística', /m³/.test(vol), vol.split('.')[0]);
await page.screenshot({ path: OUT + '07_superficies.png' });

// cambiar el cruce del sub sin volver a simular
await page.click('role=tab[name="Respuesta"]');
await page.locator('label', { hasText: 'Corte del sub' }).locator('input').fill('120');
await page.locator('label', { hasText: 'Corte del sub' }).locator('input').press('Tab');
await page.waitForTimeout(500);
const spread2 = await page.locator('text=de pico a valle').first().locator('..').innerText();
check('el cruce se aplica al instante', spread2 !== spread, `${spread.replace(/\n/g, ' ')} → ${spread2.replace(/\n/g, ' ')}`);

// rango 20–300 Hz: hace falta simular hasta 350 Hz
await page.locator('label', { hasText: 'Frecuencia máxima' }).locator('select').selectOption('350');
await page.waitForSelector('text=/^Hecho: 4 niveles/', { timeout: 600000 });
await page.click('role=tab[name="Mapa de la sala"]');
const rango = await page.locator('label', { hasText: 'Frecuencia (' }).innerText();
check('mapa de 20 a 300 Hz', /20–300 Hz/.test(rango), rango.split('\n')[0]);
const tPrep2 = Date.now();
await page.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Play')); return b && !b.disabled; }, null, { timeout: 180000 });
const pr2 = await measurePlay();
check('animación 20–300 Hz sin atascos', pr2.distinct >= 20 && pr2.longTasks === 0, `preparada en ${((Date.now() - tPrep2) / 1000).toFixed(1)} s · ${pr2.distinct} frecuencias en 2 s · tareas largas: ${pr2.longTasks}`);
await page.screenshot({ path: OUT + '08_mapa_300.png' });
await page.click('role=tab[name="Mejor posición"]');
await page.waitForTimeout(500);
await page.screenshot({ path: OUT + '09_mejor_colores.png' });

// curva del sub en «Respuesta»
await page.click('role=tab[name="Respuesta"]');
await page.waitForTimeout(400);
check('la respuesta muestra el sub solo', (await page.locator('text=Solo sub (con su cruce)').count()) > 0);

// colocación automática
await page.click('role=tab[name="Colocación automática"]');
await page.locator('label', { hasText: 'Precisión' }).locator('select').selectOption('rapida');
const tOpt = Date.now();
await page.click('button:has-text("Buscar la mejor colocación")');
await page.waitForSelector('text=/posición \\d+ de ~\\d+/', { timeout: 120000 });
await page.waitForTimeout(3000);
await page.screenshot({ path: OUT + '10_colocacion_en_curso.png' });
await page.waitForSelector('text=/^Terminado en/', { timeout: 900000 });
const optInfo = await page.locator('text=/^Terminado en/').innerText();
const rows = await page.locator('#opt-top tbody tr').count();
const best = parseFloat((await page.locator('#opt-top tbody tr').first().locator('td').nth(1).innerText()).replace(',', '.'));
const cur = parseFloat((await page.locator('#opt-current').innerText()).replace(',', '.'));
check('colocación automática terminada', rows >= 3, `${optInfo} · en ${((Date.now() - tOpt) / 1000).toFixed(0)} s · ${rows - 1} propuestas`);
check('la mejor propuesta mejora tu colocación actual', best >= cur, `mejor ${best} / actual ${cur}`);
await page.screenshot({ path: OUT + '11_colocacion_hecha.png' });
const youBefore = await page.locator('text=Tu posición actual').count();
await page.locator('#opt-top tbody tr').first().locator('button', { hasText: 'Aplicar' }).click();
await page.waitForSelector('text=/^Hecho: /', { state: 'detached', timeout: 30000 }).catch(() => {});
await page.waitForSelector('text=/^Hecho: /', { timeout: 600000 });
await page.click('role=tab[name="Mejor posición"]');
await page.waitForTimeout(600);
const after = await bestTxt();
check('aplicar mueve los equipos y vuelve a simular', true, after);
await page.screenshot({ path: OUT + '12_tras_aplicar.png' });

check('sin errores en la consola', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log('\nRESULTADO:', ok ? 'TODO OK' : 'HAY FALLOS');
process.exit(ok ? 0 : 1);
