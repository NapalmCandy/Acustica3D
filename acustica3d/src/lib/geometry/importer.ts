// Importación de modelos de SketchUp (.skp directamente, o exportados: COLLADA .dae, OBJ .obj, glTF .glb/.gltf)
// y extracción de triángulos con su material, en metros y con Y hacia arriba.
import * as THREE from 'three';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { NamedTris } from '../sim/testgeo';
import { parseSkp } from './skp';

export interface ImportedModel {
	fileName: string;
	object: THREE.Object3D; // para la vista 3D
	tris: NamedTris; // para la simulación
	materialNames: string[];
	bbox: { min: [number, number, number]; max: [number, number, number] };
	warnings: string[];
}

function materialName(m: THREE.Material | undefined): string {
	const n = (m?.name ?? '').trim();
	return n || 'sin_material';
}

/** Extrae triángulos en coordenadas de mundo con el nombre de su material. */
export function extractTris(root: THREE.Object3D): NamedTris {
	root.updateMatrixWorld(true);
	const out: NamedTris = { positions: [], materials: [] };
	const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
	root.traverse((o) => {
		const mesh = o as THREE.Mesh;
		if (!mesh.isMesh || !mesh.geometry) return;
		const geom = mesh.geometry as THREE.BufferGeometry;
		const pos = geom.getAttribute('position');
		if (!pos) return;
		const index = geom.getIndex();
		const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
		const groups = geom.groups.length ? geom.groups : [{ start: 0, count: index ? index.count : pos.count, materialIndex: 0 }];
		for (const gr of groups) {
			const mname = materialName(mats[gr.materialIndex ?? 0]);
			for (let i = gr.start; i + 2 < gr.start + gr.count; i += 3) {
				for (let k = 0; k < 3; k++) {
					const vi = index ? index.getX(i + k) : i + k;
					v[k].fromBufferAttribute(pos, vi).applyMatrix4(mesh.matrixWorld);
				}
				out.positions.push(v[0].x, v[0].y, v[0].z, v[1].x, v[1].y, v[1].z, v[2].x, v[2].y, v[2].z);
				out.materials.push(mname);
			}
		}
	});
	return out;
}

export async function importFile(file: File): Promise<ImportedModel> {
	const name = file.name;
	const ext = name.split('.').pop()?.toLowerCase();
	const warnings: string[] = [];
	let object: THREE.Object3D;
	if (ext === 'skp') {
		const m = await parseSkp(new Uint8Array(await file.arrayBuffer()));
		warnings.push(...m.warnings);
		object = objectFromTris(m.tris, (n) => m.colors.get(n) ?? '#cccccc');
	} else if (ext === 'dae') {
		const text = await file.text();
		const res = new ColladaLoader().parse(text, '');
		if (!res) throw new Error('No se pudo leer el archivo COLLADA.');
		object = res.scene;
	} else if (ext === 'obj') {
		const text = await file.text();
		object = new OBJLoader().parse(text);
		warnings.push(
			'OBJ: comprueba que exportaste en metros (SketchUp: Opciones de exportación > Unidades). Los nombres de material vienen de "usemtl".'
		);
		// OBJ de SketchUp suele venir con Z arriba solo si se elige; por defecto Y arriba.
	} else if (ext === 'glb' || ext === 'gltf') {
		const buf = await file.arrayBuffer();
		const gltf = await new GLTFLoader().parseAsync(buf, '');
		object = gltf.scene;
	} else {
		throw new Error('Formato no soportado. Abre el .skp de SketchUp directamente, o expórtalo como .dae, .obj o .glb.');
	}
	const tris = extractTris(object);
	if (!tris.materials.length) throw new Error('El modelo no contiene caras (triángulos).');
	const box = new THREE.Box3().setFromObject(object);
	const size = new THREE.Vector3();
	box.getSize(size);
	if (Math.max(size.x, size.y, size.z) > 60) warnings.push(`El modelo mide ${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} m: ¿unidades en pulgadas o centímetros?`);
	if (Math.max(size.x, size.y, size.z) < 1) warnings.push('El modelo es muy pequeño (< 1 m): revisa las unidades de exportación.');
	const materialNames = [...new Set(tris.materials)].sort((a, b) => a.localeCompare(b, 'es'));
	if (materialNames.length === 1) warnings.push('Todas las caras tienen el mismo material: renombra en SketchUp las superficies importantes (pared, techo, suelo, paneles…).');
	return {
		fileName: name,
		object,
		tris,
		materialNames,
		bbox: { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] },
		warnings
	};
}

/** Construye un objeto 3D a partir de triángulos con nombre (sala de ejemplo). */
export function objectFromTris(nt: NamedTris, colorOf: (m: string) => string): THREE.Object3D {
	const group = new THREE.Group();
	const byMat = new Map<string, number[]>();
	nt.materials.forEach((m, t) => {
		let arr = byMat.get(m);
		if (!arr) byMat.set(m, (arr = []));
		for (let k = 0; k < 9; k++) arr.push(nt.positions[t * 9 + k]);
	});
	for (const [m, arr] of byMat) {
		const g = new THREE.BufferGeometry();
		g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
		g.computeVertexNormals();
		const mat = new THREE.MeshStandardMaterial({ color: colorOf(m), side: THREE.DoubleSide });
		mat.name = m;
		group.add(new THREE.Mesh(g, mat));
	}
	return group;
}
