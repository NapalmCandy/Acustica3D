// Empaqueta Acustica3D para Windows: carpeta dist/Acustica3D (Acustica3D.exe + web + LEEME.txt) y, a partir de ella,
//   dist/Acustica3D_win64.zip  → descarga manual
//   dist/Acustica3D_win64.pack → paquete del actualizador automático (formato propio, ver launcher/acustica3d.c)
//   dist/Sala3D_win64.pack     → el mismo, con el .exe llamado Sala3D.exe, para que las instalaciones de
//                                 la v0.3.0 (cuando se llamaba Sala3D) también se actualicen; al arrancar
//                                 se renombra solo a Acustica3D.exe. Se puede quitar cuando nadie tenga la 0.3.0.
// Uso: node scripts/package.mjs 0.3.0   (después de `npm run build` y de compilar launcher/Acustica3D.exe)
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, readdirSync, statSync, openSync, writeSync, closeSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error('Uso: node scripts/package.mjs X.Y.Z');
const out = 'dist/Acustica3D';
rmSync('dist', { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync('launcher/Acustica3D.exe', join(out, 'Acustica3D.exe'));
cpSync('build', join(out, 'web'), { recursive: true });
const leeme = readFileSync('launcher/LEEME.txt', 'utf8').replaceAll('{{VERSION}}', version);
writeFileSync(join(out, 'LEEME.txt'), '﻿' + leeme.replace(/\r?\n/g, '\r\n'));

execFileSync('zip', ['-qr', 'Acustica3D_win64.zip', 'Acustica3D'], { cwd: 'dist' });

const files = [];
const walk = (d) => {
	for (const n of readdirSync(d).sort()) {
		const p = join(d, n);
		if (statSync(p).isDirectory()) walk(p);
		else files.push(p);
	}
};
walk(out);
function writePack(path, rename = (r) => r) {
const fd = openSync(path, 'w');
writeSync(fd, Buffer.from('A3DPACK1'));
for (const f of files) {
	const rel = Buffer.from(rename(relative(out, f).split(sep).join('/')), 'utf8');
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
}
writePack('dist/Acustica3D_win64.pack');
writePack('dist/Sala3D_win64.pack', (r) => (r === 'Acustica3D.exe' ? 'Sala3D.exe' : r));
console.log(`Acustica3D ${version}: ${files.length} archivos → dist/Acustica3D_win64.zip, .pack y Sala3D_win64.pack (transición)`);
