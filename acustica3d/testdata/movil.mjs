import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [name, scheme] of [['movil_claro', 'light'], ['movil_oscuro', 'dark']]) {
  const p = await b.newPage({ viewport: { width: 400, height: 860 }, colorScheme: scheme });
  await p.goto('http://localhost:4174/_visor_test.html');
  await p.click('text=Sala de ejemplo');
  await p.waitForTimeout(1500);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log(name, 'desbordamiento horizontal (px):', overflow);
  await p.screenshot({ path: `testdata/capturas/${name}.png` });
}
const d = await b.newPage({ viewport: { width: 1600, height: 1000 }, colorScheme: 'dark' });
await d.goto('http://localhost:4174/_visor_test.html');
await d.click('text=Sala de ejemplo');
await d.waitForSelector('text=/^Hecho: /', { timeout: 120000 });
await d.waitForTimeout(500);
await d.screenshot({ path: 'testdata/capturas/escritorio_oscuro.png' });
await b.close();
