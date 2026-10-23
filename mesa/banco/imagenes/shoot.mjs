import { chromium } from '/home/user/acustica3d/acustica3d/node_modules/playwright/index.mjs';
const shots = process.argv.slice(2); // v:p:archivo
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const s of shots) {
	const [v, p, out] = s.split(':');
	const pg = await b.newPage({ viewport: { width: 1600, height: 1000 } });
	pg.on('pageerror', (e) => console.log('pageerror', e.message));
	pg.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text()); });
	await pg.goto(`http://localhost:8765/${process.env.PAGE ?? 'index.html'}?v=${v}&p=${p}`);
	await pg.waitForFunction(() => window.__done === true, null, { timeout: 120000 });
	await pg.screenshot({ path: out });
	await pg.close();
	console.log('ok', out);
}
await b.close();
