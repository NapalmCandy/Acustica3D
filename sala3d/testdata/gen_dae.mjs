// Genera un .dae al estilo de SketchUp (Z arriba, pulgadas) a partir de la sala de ejemplo.
import { writeFileSync } from 'node:fs';
const boxes = [];
const addBox = (mn, mx, mat) => boxes.push({ mn, mx, mat });
const W = 4.2, H = 2.6, D = 3.6, t = 0.12;
addBox([-t, -t, -t], [W + t, 0, D + t], (f) => (f === 'y+' ? 'Suelo_tarima' : 'Hormigon'));
addBox([-t, H, -t], [W + t, H + t, D + t], (f) => (f === 'y-' ? 'Falso_techo' : 'Hormigon'));
addBox([-t, 0, -t], [0, H, D + t], (f) => (f === 'x+' ? 'Pladur' : 'Ladrillo'));
addBox([W, 0, -t], [W + t, H, D + t], (f) => (f === 'x-' ? 'Pladur' : 'Ladrillo'));
addBox([0, 0, -t], [W, H, 0], (f) => (f === 'z+' ? 'Pladur' : 'Ladrillo'));
addBox([0, 0, D], [W, H, D + t], (f) => (f === 'z-' ? 'Pladur' : 'Ladrillo'));
addBox([0.3, 0, D - 0.02], [1.12, 2.03, D], () => 'Puerta');
addBox([W - 0.02, 1.0, 1.2], [W, 2.2, 2.4], () => 'Ventana');
addBox([1.2, 0.72, 0.25], [3.0, 0.75, 1.05], () => 'Escritorio');
addBox([0.05, 0.5, 2.2], [0.1, 1.7, 3.0], () => 'Panel_LR_50mm');
const tris = {};
for (const b of boxes) {
  const [x0, y0, z0] = b.mn, [x1, y1, z1] = b.mx;
  const quads = [
    ['x-', [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
    ['x+', [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]],
    ['y-', [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
    ['y+', [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]],
    ['z-', [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]],
    ['z+', [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]
  ];
  for (const [f, a, bb, c, d] of quads) {
    const m = b.mat(f);
    (tris[m] ??= []).push(a, bb, c, a, c, d);
  }
}
// Three (Y arriba) → SketchUp (Z arriba): (x, y, z) → (x, -z, y), en pulgadas
const sk = (p) => [p[0], -p[2], p[1]].map((v) => (v / 0.0254).toFixed(4));
const mats = Object.keys(tris);
const color = { Suelo_tarima: '0.66 0.5 0.35', Hormigon: '0.6 0.6 0.6', Falso_techo: '0.93 0.93 0.9', Pladur: '0.85 0.83 0.8', Ladrillo: '0.7 0.44 0.35', Puerta: '0.54 0.35 0.23', Ventana: '0.62 0.78 0.85', Escritorio: '0.75 0.6 0.42', Panel_LR_50mm: '0.89 0.78 0.42' };
let effects = '', materials = '', geoms = '', insts = '';
mats.forEach((m, i) => {
  effects += `<effect id="${m}-effect" name="${m}-effect"><profile_COMMON><technique sid="COMMON"><lambert><diffuse><color>${color[m]} 1</color></diffuse></lambert></technique></profile_COMMON></effect>\n`;
  materials += `<material id="${m}ID" name="${m}"><instance_effect url="#${m}-effect"/></material>\n`;
  const pts = tris[m].map(sk).flat();
  const n = tris[m].length;
  geoms += `<geometry id="mesh${i}"><mesh><source id="mesh${i}-pos"><float_array id="mesh${i}-pos-array" count="${n * 3}">${pts.join(' ')}</float_array><technique_common><accessor count="${n}" source="#mesh${i}-pos-array" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source><vertices id="mesh${i}-vtx"><input semantic="POSITION" source="#mesh${i}-pos"/></vertices><triangles count="${n / 3}" material="Material${i}"><input offset="0" semantic="VERTEX" source="#mesh${i}-vtx"/><p>${[...Array(n).keys()].join(' ')}</p></triangles></mesh></geometry>\n`;
  insts += `<instance_geometry url="#mesh${i}"><bind_material><technique_common><instance_material symbol="Material${i}" target="#${m}ID"/></technique_common></bind_material></instance_geometry>\n`;
});
const dae = `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
<asset><contributor><authoring_tool>SketchUp 23 (simulado para pruebas)</authoring_tool></contributor><unit meter="0.0254" name="inch"/><up_axis>Z_UP</up_axis></asset>
<library_visual_scenes><visual_scene id="ID1"><node name="SketchUp">${insts}</node></visual_scene></library_visual_scenes>
<library_geometries>${geoms}</library_geometries>
<library_materials>${materials}</library_materials>
<library_effects>${effects}</library_effects>
<scene><instance_visual_scene url="#ID1"/></scene>
</COLLADA>`;
writeFileSync(new URL('./sala_prueba_sketchup.dae', import.meta.url), dae);
console.log('ok', mats.length, 'materiales');
