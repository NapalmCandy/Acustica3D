import { chromium } from '/home/user/acustica3d/acustica3d/node_modules/playwright/index.mjs';
const [URL, SKP, PROJ] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
p.on('pageerror', (e) => console.log('pageerror', e.message));
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console', m.type(), m.text().slice(0, 300)); });
await p.goto(URL);
await p.setInputFiles('#model-file', SKP);
await p.waitForSelector('text=/^Hecho: /', { timeout: 900000 });
console.log('skp cargado; posiciones antes:', await p.evaluate(() => document.title));
await p.setInputFiles('#project-file', PROJ);
const r = await Promise.race([
  p.waitForSelector('text=/^Hecho: /', { state: 'detached', timeout: 20000 }).then(() => p.waitForSelector('text=/^Hecho: /', { timeout: 900000 })).then(() => 'hecho'),
  p.waitForSelector('text=/Error|fuera del aire/', { timeout: 900000 }).then(async (h) => 'ERROR: ' + (await h.innerText()))
]).catch((e) => 'timeout ' + e.message);
console.log(r);
const errs = await p.locator('aside .text-red-700, aside [class*=red]').allInnerTexts();
console.log('mensajes rojos:', errs.join(' | '));
await b.close();
