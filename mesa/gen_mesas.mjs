// Mesas acústicas para el Estudio v0.05: genera los .dae para importar en SketchUp (Z arriba, en el
// origen del modelo, metros de SketchUp: X a lo ancho, Y hacia la pared frontal, Z arriba).
// Uso: node mesa/gen_mesas.mjs   → mesa/Mesa_con_lana.dae y mesa/Mesa_sin_lana.dae
import { writeFileSync } from 'node:fs';

const COLOR = {
	'Madera DM': '0.75 0.6 0.42',
	'Lana Roca 80kg_m3': '0.89 0.78 0.42',
	'Metal pie KH': '0.2 0.2 0.22',
	'Metal torre PC': '0.15 0.15 0.17',
	'Plastico teclado MIDI': '0.1 0.1 0.12'
};
const box = ([x0, y0, z0], [x1, y1, z1]) => [
	[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
	[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]
];
/** caja cuya cara de arriba (y la de abajo, si `both`) sube `rise` m desde y0 hasta y1 (tablero inclinado) */
const sloped = ([x0, y0, z0], [x1, y1, z1], rise, both = true) => {
	const c = box([x0, y0, z0], [x1, y1, z1]);
	for (const i of both ? [2, 3, 6, 7] : [6, 7]) c[i][2] += rise; // los vértices de y1
	return c;
};
/** 12 triángulos de un sólido de 8 vértices (orden de `box`), caras hacia fuera */
const faces = (c) => {
	const q = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]];
	return q.flatMap(([a, b, d, e]) => [c[a], c[b], c[d], c[a], c[d], c[e]]);
};
const khStands = (G) => {
	for (const [lado, x] of [['izquierdo', 1.376], ['derecho', 2.743]]) {
		const y = 5.673;
		G(`Pie KH ${lado}`, 'Metal pie KH',
			box([x - 0.15, y - 0.15, 0], [x + 0.15, y + 0.15, 0.02]),
			box([x - 0.03, y - 0.03, 0.02], [x + 0.03, y + 0.03, 0.93]),
			box([x - 0.095, y - 0.12, 0.93], [x + 0.095, y + 0.12, 0.95]));
	}
};

function conLana(G) {
	const X0 = 1.13, X1 = 2.98, YF = 4.62, YB = 5.5, TOP = 0.73, T = 0.025;
	G('Tablero', 'Madera DM', box([X0, YF, TOP - T], [X1, YB, TOP]));
	G('Lateral izquierdo', 'Madera DM', box([X0, YF + 0.05, 0], [X0 + 0.025, YB - 0.05, TOP - T]));
	G('Lateral derecho', 'Madera DM', box([X1 - 0.025, YF + 0.05, 0], [X1, YB - 0.05, TOP - T]));
	// lana de roca 80 kg/m³, 50 mm, forrada de tela fina, de 23 a 53 cm del borde
	G('Absorbente de la mesa', 'Lana Roca 80kg_m3', box([X0 + 0.03, 4.85, TOP], [X1 - 0.03, 5.15, TOP + 0.05]));
	khStands(G);
}

function sinLana(G) {
	// franja de 32 cm para el teclado y el ratón, inclinada 10° (sube hacia los KH), sin nada detrás
	const X0 = 1.13, X1 = 2.98, YF = 4.5, D = 0.32, YB = YF + D, TOP = 0.73, T = 0.025;
	const rise = D * Math.tan((10 * Math.PI) / 180);
	G('Tablero inclinado', 'Madera DM', sloped([X0, YF, TOP - T], [X1, YB, TOP], rise));
	G('Lateral izquierdo', 'Madera DM', sloped([X0, YF + 0.02, 0], [X0 + 0.025, YB - 0.02, TOP - T], rise * (D - 0.04) / D, false));
	G('Lateral derecho', 'Madera DM', sloped([X1 - 0.025, YF + 0.02, 0], [X1, YB - 0.02, TOP - T], rise * (D - 0.04) / D, false));
	// bandeja extraíble para el teclado MIDI (105 × 30 cm) bajo el tablero, a 60 cm
	const C = (X0 + X1) / 2;
	G('Bandeja teclado MIDI', 'Madera DM', box([C - 0.525, YF + 0.02, 0.585], [C + 0.525, YF + 0.32, 0.6]));
	G('Teclado MIDI 61 teclas (ejemplo)', 'Plastico teclado MIDI', box([C - 0.475, YF + 0.045, 0.6], [C + 0.475, YF + 0.295, 0.69]));
	// la torre en el suelo, bajo el extremo izquierdo (fuera de los caminos de los KH al oído)
	G('Torre PC (ejemplo)', 'Metal torre PC', box([X0 + 0.05, 4.8, 0], [X0 + 0.25, 5.25, 0.47]));
	khStands(G);
}

function dae(build) {
	const groups = [];
	build((name, mat, ...solids) => groups.push({ name, mat, solids }));
	const inch = (v) => (v / 0.0254).toFixed(4);
	const mats = [...new Set(groups.map((g) => g.mat))];
	let effects = '', materials = '', geoms = '', nodes = '';
	mats.forEach((m, i) => {
		effects += `<effect id="fx${i}"><profile_COMMON><technique sid="COMMON"><lambert><diffuse><color>${COLOR[m]} 1</color></diffuse></lambert></technique></profile_COMMON></effect>\n`;
		materials += `<material id="mat${i}" name="${m}"><instance_effect url="#fx${i}"/></material>\n`;
	});
	groups.forEach((g, gi) => {
		const pts = g.solids.flatMap(faces);
		const n = pts.length, mi = mats.indexOf(g.mat);
		geoms += `<geometry id="g${gi}"><mesh><source id="g${gi}-p"><float_array id="g${gi}-a" count="${n * 3}">${pts.flat().map(inch).join(' ')}</float_array><technique_common><accessor count="${n}" source="#g${gi}-a" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source><vertices id="g${gi}-v"><input semantic="POSITION" source="#g${gi}-p"/></vertices><triangles count="${n / 3}" material="m"><input offset="0" semantic="VERTEX" source="#g${gi}-v"/><p>${[...Array(n).keys()].join(' ')}</p></triangles></mesh></geometry>\n`;
		nodes += `<node id="n${gi}" name="${g.name}"><instance_geometry url="#g${gi}"><bind_material><technique_common><instance_material symbol="m" target="#mat${mi}"/></technique_common></bind_material></instance_geometry></node>\n`;
	});
	return `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
<asset><contributor><authoring_tool>Acustica3D</authoring_tool></contributor><unit meter="0.0254" name="inch"/><up_axis>Z_UP</up_axis></asset>
<library_effects>${effects}</library_effects>
<library_materials>${materials}</library_materials>
<library_geometries>${geoms}</library_geometries>
<library_visual_scenes><visual_scene id="escena"><node id="mesa" name="Mesa acustica">${nodes}</node></visual_scene></library_visual_scenes>
<scene><instance_visual_scene url="#escena"/></scene>
</COLLADA>`;
}

writeFileSync(new URL('./Mesa_con_lana.dae', import.meta.url), dae(conLana));
writeFileSync(new URL('./Mesa_sin_lana.dae', import.meta.url), dae(sinLana));
console.log('ok: mesa/Mesa_con_lana.dae, mesa/Mesa_sin_lana.dae');
