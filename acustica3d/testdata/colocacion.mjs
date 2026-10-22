// Colocación automática en Chromium con la sala de prueba: cuánto tarda y qué puntuación saca.
// Uso: node testdata/colocacion.mjs URL [rapida|normal|fina] [cualquiera|cerca] [cpu|gpu] [bayes|rejilla]
import { chromium } from 'playwright';
const [APP_URL = 'http://localhost:4173/', PREC = 'normal', SUB = 'cualquiera', ENGINE = 'cpu', METHOD = 'bayes'] = process.argv.slice(2);
const browser = await chromium.launch({
	executablePath: '/opt/pw-browsers/chromium',
	args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...(ENGINE === 'gpu' ? ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] : [])]
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('consola:', m.text()); });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(APP_URL);
await page.waitForSelector('h1:has-text("Acustica3D")');
await page.setInputFiles('#model-file', new URL('./sala_prueba_sketchup.dae', import.meta.url).pathname);
await page.waitForSelector('text=/^Hecho: /', { timeout: 600000 });
await page.locator('label', { hasText: 'Motor' }).locator('select').selectOption(ENGINE);
await page.waitForTimeout(500);
await page.waitForSelector('text=/^Hecho: /', { timeout: 600000 });
await page.click('role=tab[name="Colocación automática"]');
await page.locator('label', { hasText: 'Precisión' }).locator('select').selectOption(PREC);
await page.locator('label', { hasText: /^Sub/ }).locator('select').selectOption(SUB);
await page.locator('label', { hasText: 'Búsqueda' }).locator('select').selectOption(METHOD);
const t0 = Date.now();
await page.click('button:has-text("Buscar la mejor colocación")');
const res = await Promise.race([
	page.waitForSelector('text=/^Terminado en/', { timeout: 3600000 }).then(() => null),
	page.waitForSelector('#opt-error', { timeout: 3600000 }).then(async (h) => await h.innerText())
]);
if (res) {
	console.log('ERROR:', res);
	process.exit(1);
}
const info = await page.locator('text=/^Terminado en/').innerText();
const best = await page.locator('#opt-top tbody tr').first().locator('td').nth(1).innerText();
const pos = await page.locator('#opt-top tbody tr').first().locator('td').nth(2).innerText();
console.log(`${METHOD} · ${PREC} · ${ENGINE}: ${info} · ${((Date.now() - t0) / 1000).toFixed(0)} s · mejor ${best} en ${pos}`);
await browser.close();
