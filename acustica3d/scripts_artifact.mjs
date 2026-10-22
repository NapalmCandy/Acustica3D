// Convierte build/index.html en el fragmento que espera el visor de artefactos (sin <html>/<head>/<body>).
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs';
const html = readFileSync('build/index.html', 'utf8');
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1];
const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/)[1];
const keep = head
	.split('\n')
	.map((l) => l.trim())
	.filter((l) => l.startsWith('<link') || l.startsWith('<meta name="description"'))
	.join('\n');
const frag = `<title>Acustica3D</title>\n${keep}\n${body.trim()}\n`;
rmSync('artifact', { recursive: true, force: true });
mkdirSync('artifact', { recursive: true });
writeFileSync('artifact/index.html', frag);
cpSync('build/app', 'artifact/app', { recursive: true });
cpSync('build/favicon.svg', 'artifact/favicon.svg');
console.log(frag);
