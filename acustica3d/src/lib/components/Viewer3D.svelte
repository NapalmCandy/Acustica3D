<script lang="ts">
	import { onMount } from 'svelte';
	import * as THREE from 'three';
	import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
	import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
	import { app, type DeviceId } from '../state.svelte';
	import { LIBRARY } from '../acoustics/materials';
	import { mapOverlay } from '../mapOverlay.svelte';
	import { objectLocalTris } from '../geometry/objects';

	let host: HTMLDivElement;
	let renderer: THREE.WebGLRenderer;
	let scene: THREE.Scene;
	let camera: THREE.PerspectiveCamera;
	let orbit: OrbitControls;
	let gizmo: TransformControls;
	let modelGroup = new THREE.Group();
	const devices: Record<DeviceId, THREE.Object3D> = {} as Record<DeviceId, THREE.Object3D>;
	let areaMesh: THREE.Mesh;
	let overlayMesh: THREE.Mesh | null = null;
	const clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 100);
	let raf = 0;
	// se dibuja solo cuando algo cambia (cámara, objetos, mapa…): menos carga y animaciones más fluidas
	let dirty = true;
	const objGroup = new THREE.Group();
	const objMeshes = new Map<string, THREE.Mesh>();

	const DEVICE_COLORS: Record<DeviceId, number> = { khL: 0x2a78d6, khR: 0xeb6834, sub: 0x4b4a46, listener: 0x1baf7a };

	function makeDevice(id: DeviceId): THREE.Object3D {
		const g = new THREE.Group();
		g.name = id;
		const mat = new THREE.MeshStandardMaterial({ color: DEVICE_COLORS[id], roughness: 0.5 });
		if (id === 'khL' || id === 'khR') {
			// KH 120 A: 182 × 277 × 220 mm, frente hacia +Z local
			const box = new THREE.Mesh(new THREE.BoxGeometry(0.182, 0.277, 0.22), mat);
			const front = new THREE.Mesh(
				new THREE.CircleGeometry(0.05, 24),
				new THREE.MeshStandardMaterial({ color: 0x111111 })
			);
			front.position.set(0, -0.04, 0.111);
			g.add(box, front);
		} else if (id === 'sub') {
			const box = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.37, 0.37), mat);
			box.position.y = 0.0;
			g.add(box);
		} else {
			const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 24, 16), mat);
			const nose = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.06, 12), mat);
			nose.rotation.x = -Math.PI / 2;
			nose.position.z = -0.1;
			g.add(head, nose);
		}
		g.traverse((o) => ((o as THREE.Mesh).userData.deviceId = id));
		return g;
	}

	function colorFor(skpName: string): THREE.Color {
		const id = app.matMap[skpName]?.libId;
		return new THREE.Color(LIBRARY.find((l) => l.id === id)?.color ?? '#cccccc');
	}

	function setModel(obj: THREE.Object3D | null) {
		dirty = true;
		scene.remove(modelGroup);
		modelGroup = new THREE.Group();
		if (obj) {
			const clone = obj.clone(true);
			clone.traverse((o) => {
				const m = o as THREE.Mesh;
				if (!m.isMesh) return;
				const mats = Array.isArray(m.material) ? m.material : [m.material];
				const newMats = mats.map((mm) => {
					const nm = new THREE.MeshStandardMaterial({
						color: colorFor(mm?.name || 'sin_material'), side: THREE.DoubleSide, transparent: true,
						opacity: app.view.wallOpacity, roughness: 0.9, clippingPlanes: [clip]
					});
					nm.name = mm?.name || 'sin_material';
					return nm;
				});
				m.material = Array.isArray(m.material) ? newMats : newMats[0];
			});
			modelGroup.add(clone);
			// aristas para leer la geometría
			clone.traverse((o) => {
				const m = o as THREE.Mesh;
				if (!m.isMesh) return;
				const edges = new THREE.LineSegments(
					new THREE.EdgesGeometry(m.geometry, 25),
					new THREE.LineBasicMaterial({ color: 0x55534e, transparent: true, opacity: 0.35, clippingPlanes: [clip] })
				);
				edges.matrixAutoUpdate = false;
				m.updateMatrixWorld(true);
				edges.matrix.copy(m.matrixWorld);
				modelGroup.add(edges);
			});
		}
		scene.add(modelGroup);
		fitCamera();
	}

	function fitCamera() {
		dirty = true;
		if (!app.bbox) return;
		const { min, max } = app.bbox;
		const c = new THREE.Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
		const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
		camera.position.set(c.x + size * 0.9, c.y + size * 1.1, c.z + size * 1.3);
		orbit.target.copy(c);
		orbit.update();
	}

	function updateDevices() {
		dirty = true;
		const L = app.positions.listener;
		for (const id of Object.keys(devices) as DeviceId[]) {
			const p = app.positions[id];
			const o = devices[id];
			if (gizmo.object !== o || !gizmo.dragging) o.position.set(p[0], p[1], p[2]);
			o.visible = id !== 'sub' || app.sub.enabled;
			if (id === 'khL' || id === 'khR') o.lookAt(L[0], L[1], L[2]);
			if (id === 'listener') {
				// mira hacia el punto medio de los KH
				const kl = app.positions.khL, kr = app.positions.khR;
				const target = new THREE.Vector3((kl[0] + kr[0]) / 2, L[1], (kl[2] + kr[2]) / 2);
				const dir = target.sub(new THREE.Vector3(...L));
				o.rotation.set(0, Math.atan2(-dir.x, -dir.z), 0);
			}
		}
		const h = app.sim.areaHalf;
		areaMesh.scale.set(2 * h, 2 * h, 1);
		areaMesh.position.set(L[0], L[1] - 0.001, L[2]);
	}

	/** Mantiene una caja por objeto añadido (se reutilizan para no soltar el gizmo mientras se arrastra). */
	function syncObjects() {
		dirty = true;
		const alive = new Set(app.objects.map((o) => o.id));
		for (const [id, m] of objMeshes) {
			if (alive.has(id)) continue;
			if (gizmo.object === m) gizmo.detach();
			objGroup.remove(m);
			m.geometry.dispose();
			(m.material as THREE.Material).dispose();
			objMeshes.delete(id);
		}
		for (const o of app.objects) {
			let m = objMeshes.get(o.id);
			if (!m) {
				m = new THREE.Mesh(
					new THREE.BoxGeometry(1, 1, 1),
					new THREE.MeshStandardMaterial({ roughness: 0.85, transparent: true, opacity: 0.9 })
				);
				m.name = `obj:${o.id}`;
				m.userData.deviceId = m.name;
				const edges = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: 0x2c2b28 }));
				edges.raycast = () => {};
				m.add(edges);
				objMeshes.set(o.id, m);
				objGroup.add(m);
			}
			(m.material as THREE.MeshStandardMaterial).color.set(LIBRARY.find((l) => l.id === o.libId)?.color ?? '#cccccc');
			// la forma dibujada en SketchUp (si la hay) o una caja unidad escalada
			const key = o.mesh ? `${o.mesh.length}|${o.size.join()}|${o.meshSize?.join()}` : 'caja';
			if (m.userData.key !== key) {
				const g = new THREE.BufferGeometry();
				if (o.mesh) {
					g.setAttribute('position', new THREE.Float32BufferAttribute(objectLocalTris(o).flat(2), 3));
					g.computeVertexNormals();
				} else g.copy(new THREE.BoxGeometry(1, 1, 1));
				m.geometry.dispose();
				m.geometry = g;
				const edges = m.children[0] as THREE.LineSegments;
				edges.geometry.dispose();
				edges.geometry = new THREE.EdgesGeometry(g, 20);
				m.userData.key = key;
			}
			if (o.mesh) m.scale.set(1, 1, 1);
			else m.scale.set(Math.max(0.02, o.size[0]), Math.max(0.02, o.size[1]), Math.max(0.02, o.size[2]));
			m.rotation.set(((o.rotX ?? 0) * Math.PI) / 180, (o.rotY * Math.PI) / 180, 0, 'YXZ');
			if (gizmo.object !== m || !gizmo.dragging) m.position.set(o.pos[0], o.pos[1], o.pos[2]);
		}
	}

	function attachSelected() {
		dirty = true;
		const sel = app.selected;
		const target = !sel ? null : sel.startsWith('obj:') ? objMeshes.get(sel.slice(4)) : devices[sel as DeviceId];
		if (target) gizmo.attach(target);
		else gizmo.detach();
	}

	let overlayKey = '';
	function updateOverlay() {
		dirty = true;
		const ov = mapOverlay.current;
		const key = ov ? `${ov.nx}|${ov.nz}|${ov.dx}|${ov.origin.join(',')}|${ov.y}` : '';
		// misma rejilla y mismo lienzo (p. ej. la animación del mapa): solo se refresca la textura
		if (overlayMesh && ov && app.view.showMap && key === overlayKey) {
			const mat = overlayMesh.material as THREE.MeshBasicMaterial;
			if (mat.map && mat.map.image === ov.canvas) {
				mat.map.needsUpdate = true;
				return;
			}
		}
		if (overlayMesh) {
			scene.remove(overlayMesh);
			(overlayMesh.material as THREE.MeshBasicMaterial).map?.dispose();
			overlayMesh.geometry.dispose();
			(overlayMesh.material as THREE.Material).dispose();
			overlayMesh = null;
		}
		overlayKey = '';
		if (!ov || !app.view.showMap) return;
		const tex = new THREE.CanvasTexture(ov.canvas);
		tex.magFilter = THREE.NearestFilter;
		tex.colorSpace = THREE.SRGBColorSpace;
		const w = ov.nx * ov.dx, d = ov.nz * ov.dx;
		const mesh = new THREE.Mesh(
			new THREE.PlaneGeometry(w, d),
			new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
		);
		mesh.rotation.x = -Math.PI / 2;
		mesh.position.set(ov.origin[0] + w / 2, ov.y, ov.origin[2] + d / 2);
		overlayMesh = mesh;
		overlayKey = key;
		scene.add(mesh);
	}

	onMount(() => {
		renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
		renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
		renderer.localClippingEnabled = true;
		host.appendChild(renderer.domElement);
		scene = new THREE.Scene();
		camera = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
		camera.position.set(6, 6, 8);
		orbit = new OrbitControls(camera, renderer.domElement);
		orbit.enableDamping = true;
		scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a80, 1.6));
		const sun = new THREE.DirectionalLight(0xffffff, 1.2);
		sun.position.set(4, 8, 5);
		scene.add(sun);
		scene.add(modelGroup);
		scene.add(objGroup);
		for (const id of ['khL', 'khR', 'sub', 'listener'] as DeviceId[]) {
			devices[id] = makeDevice(id);
			scene.add(devices[id]);
		}
		areaMesh = new THREE.Mesh(
			new THREE.PlaneGeometry(1, 1),
			new THREE.MeshBasicMaterial({ color: 0x1baf7a, transparent: true, opacity: 0.25, side: THREE.DoubleSide })
		);
		areaMesh.rotation.x = -Math.PI / 2;
		scene.add(areaMesh);

		gizmo = new TransformControls(camera, renderer.domElement);
		gizmo.setSize(0.8);
		orbit.addEventListener('change', () => (dirty = true));
		gizmo.addEventListener('change', () => (dirty = true));
		gizmo.addEventListener('dragging-changed', (e) => (orbit.enabled = !(e as unknown as { value: boolean }).value));
		gizmo.addEventListener('objectChange', () => {
			const o = gizmo.object;
			if (!o) return;
			const r = (v: number) => Math.round(v * 1000) / 1000;
			const p: [number, number, number] = [r(o.position.x), r(o.position.y), r(o.position.z)];
			if (o.name.startsWith('obj:')) {
				const ob = app.objects.find((x) => x.id === o.name.slice(4));
				if (ob) ob.pos = p;
			} else app.positions[o.name as DeviceId] = p;
		});
		scene.add(gizmo.getHelper());

		const ray = new THREE.Raycaster();
		renderer.domElement.addEventListener('pointerdown', (ev) => {
			if (gizmo.dragging) return;
			const rect = renderer.domElement.getBoundingClientRect();
			const m = new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
			ray.setFromCamera(m, camera);
			const hits = ray.intersectObjects([...Object.values(devices), ...objMeshes.values()], true);
			if (hits.length) app.selected = hits[0].object.userData.deviceId as typeof app.selected;
		});

		const ro = new ResizeObserver(() => {
			const w = host.clientWidth, h = host.clientHeight;
			renderer.setSize(w, h);
			camera.aspect = w / Math.max(1, h);
			camera.updateProjectionMatrix();
			dirty = true;
		});
		ro.observe(host);
		const loop = () => {
			if (orbit.update() || dirty) {
				dirty = false;
				renderer.render(scene, camera);
			}
			raf = requestAnimationFrame(loop);
		};
		loop();
		return () => {
			cancelAnimationFrame(raf);
			ro.disconnect();
			gizmo.dispose();
			orbit.dispose();
			renderer.dispose();
		};
	});

	$effect(() => {
		// reconstruir el modelo al cambiar el archivo o la asignación de materiales
		const obj = app.modelObject;
		void JSON.stringify(app.matMap);
		if (scene) setModel(obj);
	});
	$effect(() => {
		void JSON.stringify(app.positions);
		void app.sim.areaHalf;
		void app.sub.enabled;
		if (scene) updateDevices();
	});
	$effect(() => {
		void JSON.stringify(app.objects);
		if (scene) {
			syncObjects();
			attachSelected();
		}
	});
	$effect(() => {
		void app.selected;
		if (gizmo) attachSelected();
	});
	$effect(() => {
		const op = app.view.wallOpacity;
		modelGroup?.traverse((o) => {
			const m = o as THREE.Mesh;
			if (m.isMesh) (Array.isArray(m.material) ? m.material : [m.material]).forEach((mm) => ((mm as THREE.Material).opacity = op));
		});
		dirty = true;
	});
	$effect(() => {
		const top = app.bbox ? app.bbox.max[1] : 100;
		clip.constant = app.view.hideCeiling ? Math.min(top - 0.05, app.positions.listener[1] + 1.0) : top + 10;
		dirty = true;
	});
	$effect(() => {
		void mapOverlay.current;
		void app.view.showMap;
		if (scene) updateOverlay();
	});
</script>

<div bind:this={host} class="relative h-full w-full overflow-hidden" role="img" aria-label="Vista 3D de la sala">
	<div class="pointer-events-none absolute left-3 top-3 rounded-md bg-panel/90 px-2.5 py-1.5 text-xs text-muted shadow-sm">
		Arrastra para girar · rueda para acercar · clic en un equipo u objeto para moverlo
	</div>
</div>
