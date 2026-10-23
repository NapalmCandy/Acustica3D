import { chromium } from '/home/user/acustica3d/acustica3d/node_modules/playwright/index.mjs';
const out = process.argv[2];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pg = await b.newPage({ viewport: { width: 1240, height: 1000 }, deviceScaleFactor: 2 });
pg.on('pageerror', (e) => console.log('pageerror', e.message));
await pg.goto('http://localhost:8765/charts.html');
await pg.waitForFunction(() => window.__done === true, null, { timeout: 60000 });
const names = { f1: 'Grafica_respuesta', f2: 'Grafica_reflexiones', f3: 'Grafica_desviacion', f4: 'Alzado_mesa_util' };
for (const id in names) { await pg.locator('#' + id).screenshot({ path: `${out}/${names[id]}.png` }); console.log('ok', names[id]); }
await b.close();
