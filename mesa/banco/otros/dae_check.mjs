import { chromium } from '/home/user/acustica3d/acustica3d/node_modules/playwright/index.mjs';
const [URL, ...files] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto(URL);
for (const f of files) {
	await p.setInputFiles('#model-file', f);
	await p.waitForTimeout(2500);
	const aside = await p.locator('aside').innerText();
	console.log(f.split('/').pop(), '·', aside.match(/Tamaño total\s+([^\n]+)/)?.[1], '·', aside.match(/Triángulos\s+([^\n]+)/)?.[1]);
	for (const m of ['Madera DM', 'Lana Roca 80kg_m3', 'Metal pie KH', 'Metal torre PC', 'Plastico teclado MIDI']) {
		const card = p.locator('aside div.rounded-md, aside div').filter({ hasText: new RegExp('^' + m) }).first();
		if (await card.count()) console.log('  ', m, '→', await card.locator('select').first().evaluate((s) => s.options[s.selectedIndex].text).catch(() => '?'));
	}
	await p.screenshot({ path: 'shots/' + f.split('/').pop() + '.png' });
}
await b.close();
