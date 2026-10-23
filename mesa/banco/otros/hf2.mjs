import { chromium } from '/home/user/acustica3d/acustica3d/node_modules/playwright/index.mjs';
const [URL, FILE, OUT, DAE] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
p.on('pageerror', (e) => console.log('pageerror', e.message));
p.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text()); });
await p.goto(URL);
await p.setInputFiles('#model-file', FILE);
await p.click('role=tab[name="Medios y agudos"]');
const t0 = Date.now();
await p.waitForSelector('text=/reflexiones en/', { timeout: 300000 });
console.log('tiempo', (Date.now() - t0) / 1000, 's ·', await p.locator('text=/reflexiones en/').innerText());
console.log(await p.locator('text=/reflexiones tempranas|zona libre/').first().innerText());
console.log((await p.locator('#hf-problems').innerText().catch(() => '')).split('\n').slice(0, 14).join('\n'));
await p.screenshot({ path: OUT + '/hf_difraccion.png' });
if (DAE) {
	await p.setInputFiles('#model-file', DAE);
	await p.waitForTimeout(2000);
	console.log('DAE materiales:', (await p.locator('aside').innerText()).match(/Madera DM|Lana Roca 80kg_m3|Metal pie KH/g));
	await p.screenshot({ path: OUT + '/dae.png' });
}
await b.close();
