// Empaqueta Sala3D para Windows: carpeta dist/Sala3D (Sala3D.exe + web + LEEME.txt) y, a partir de ella,
//   dist/Sala3D_win64.zip  → descarga manual
//   dist/Sala3D_win64.pack → paquete del actualizador automático (formato propio, ver launcher/sala3d_server.c)
// Uso: node scripts/package.mjs 0.3.0   (después de `npm run build` y de compilar launcher/Sala3D.exe)
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, readdirSync, statSync, openSync, writeSync, closeSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error('Uso: node scripts/package.mjs X.Y.Z');
const out = 'dist/Sala3D';
rmSync('dist', { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync('launcher/Sala3D.exe', join(out, 'Sala3D.exe'));
cpSync('build', join(out, 'web'), { recursive: true });
const leeme = readFileSync('launcher/LEEME.txt', 'utf8').replaceAll('{{VERSION}}', version);
writeFileSync(join(out, 'LEEME.txt'), '﻿' + leeme.replace(/\r?\n/g, '\r\n'));

execFileSync('zip', ['-qr', 'Sala3D_win64.zip', 'Sala3D'], { cwd: 'dist' });

const files = [];
const walk = (d) => {
	for (const n of readdirSync(d).sort()) {
		const p = join(d, n);
		if (statSync(p).isDirectory()) walk(p);
		else files.push(p);
	}
};
walk(out);
const fd = openSync('dist/Sala3D_win64.pack', 'w');
writeSync(fd, Buffer.from('A3DPACK1'));
for (const f of files) {
	const rel = Buffer.from(relative(out, f).split(sep).join('/'), 'utf8');
	const data = readFileSync(f);
	const h = Buffer.alloc(4 + rel.length + 8);
	h.writeUInt32LE(rel.length, 0);
	rel.copy(h, 4);
	h.writeBigUInt64LE(BigInt(data.length), 4 + rel.length);
	writeSync(fd, h);
	writeSync(fd, data);
}
const end = Buffer.alloc(12);
end.write('A3DEND!!', 4);
writeSync(fd, end);
closeSync(fd);
console.log(`Sala3D ${version}: ${files.length} archivos → dist/Sala3D_win64.zip y dist/Sala3D_win64.pack`);
