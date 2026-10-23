import { chromium } from '/home/user/acustica3d/acustica3d/node_modules/playwright/index.mjs';
const [URL, FILE] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto(URL);
await p.setInputFiles('#model-file', FILE);
await p.waitForSelector('text=/^Hecho: /', { timeout: 900000 });
await p.click('role=tab[name="Mapa de la sala"]');
await p.locator('label', { hasText: 'Frecuencia máxima' }).locator('select').selectOption('500');
// mientras calcula los niveles, se mueve la frecuencia del mapa (pide mapas sueltos al worker)
for (let i = 0; i < 40; i++) {
	await p.waitForTimeout(3000);
	const err = await p.locator('aside p.bg-red-500\\/10').count();
	const stage = await p.locator('aside').innerText().then((t) => (t.match(/Nivel \d\/\d[^\n]*/) ?? [''])[0]);
	const slider = p.locator('input[type=range]').first();
	if (await slider.count()) await slider.fill(String(40 + (i % 5) * 20)).catch(() => {});
	if (err) { console.log('ERROR en', stage, await p.locator('aside p.bg-red-500\\/10').innerText()); break; }
	if (await p.locator('text=/^Hecho: 5 niveles/').count()) { console.log('hecho sin errores'); break; }
	if (i % 5 === 0) console.log(stage);
}
await b.close();
