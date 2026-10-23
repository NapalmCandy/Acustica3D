import { chromium } from '/home/user/acustica3d/acustica3d/node_modules/playwright/index.mjs';
const [URL, FILE, OUT, PREC = 'rapida', MESA = 'ignorar'] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
p.on('pageerror', (e) => console.log('pageerror', e.message));
p.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text()); });
await p.goto(URL);
await p.waitForSelector('h1:has-text("Acustica3D")');
await p.setInputFiles('#model-file', FILE);
await p.waitForSelector('text=/^Hecho: /', { timeout: 900000 });
if (MESA === 'ignorar') {
	await p.locator('li', { hasText: 'Madera DM' }).locator('select').first().selectOption('ignorar');
	await p.waitForTimeout(800);
	await p.waitForSelector('text=/^Hecho: /', { timeout: 900000 });
}
await p.click('role=tab[name="Colocación automática"]');
await p.locator('label', { hasText: 'Precisión' }).locator('select').selectOption(PREC);
const t0 = Date.now();
await p.click('button:has-text("Buscar la mejor colocación")');
let last = '';
const iv = setInterval(async () => { try { const t = await p.locator('text=/posición \\d+ de ~\\d+/').first().innerText({ timeout: 1000 }); if (t !== last) { last = t; console.log(((Date.now() - t0) / 1000).toFixed(0) + ' s', t); } } catch {} }, 20000);
const res = await Promise.race([
	p.waitForSelector('text=/^Terminado en/', { timeout: 7200000 }).then(() => null),
	p.waitForSelector('#opt-error', { timeout: 7200000 }).then(async (h) => await h.innerText())
]);
clearInterval(iv);
if (res) console.log('ERROR', res);
else {
	console.log(await p.locator('text=/^Terminado en/').innerText());
	console.log('LOG\n' + (await p.locator('#opt-log').innerText().catch(() => '(sin log)')));
	console.log('TOP\n' + (await p.locator('#opt-top').innerText()));
	console.log('AJUSTES', (await p.locator('#opt-settings').innerText().catch(() => '')).replace(/\n/g, ' '));
}
await p.screenshot({ path: OUT + '/estudio_opt.png' });
await b.close();
