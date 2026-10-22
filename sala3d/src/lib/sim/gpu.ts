// Motor FDTD en la GPU (WebGPU). Mismo esquema y mismos coeficientes que el motor de procesador (fdtd.ts):
//   p2 = (B·p1 + λ²·Σvecinos − C·p0)·A   con (A,B,C) = (1,0,1) en el interior, (bA,bB,bC) en el contorno y A=0 en sólidos.
// La fuente se suma en el mismo paso; receptores y plano de mapas se graban en una segunda pasada.
import { LAMBDA, sourcePulse, type Prepared, type RunInput, type RunOutput } from './fdtd';
import { idx, cellOf, type V3, type Grid } from './voxel';

// Constantes de WebGPU (valores de la especificación; así no dependen de que el entorno defina los globales)
const BU = { MAP_READ: 0x1, COPY_SRC: 0x4, COPY_DST: 0x8, UNIFORM: 0x40, STORAGE: 0x80 } as const;
const STAGE_COMPUTE = 0x4;
const MAP_READ = 0x1;

const WGSL = /* wgsl */ `
struct P {
	nx: u32, ny: u32, nz: u32, src: u32,
	pulseLen: u32, nRcv: u32, nPlane: u32, decim: u32,
	nSteps: u32, nSamplesPlane: u32, l2: f32, pad: u32,
};
struct S { step: u32, a: u32, b: u32, c: u32 };

@group(0) @binding(0) var<uniform> prm: P;
@group(0) @binding(1) var<storage, read> coef: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> pulse: array<f32>;
@group(0) @binding(3) var<storage, read> p0: array<f32>;
@group(0) @binding(4) var<storage, read> p1: array<f32>;
@group(0) @binding(5) var<storage, read_write> p2: array<f32>;
@group(1) @binding(0) var<uniform> st: S;

@compute @workgroup_size(8, 8, 4)
fn update(@builtin(global_invocation_id) g: vec3u) {
	if (g.x == 0u || g.y == 0u || g.z == 0u || g.x >= prm.nx - 1u || g.y >= prm.ny - 1u || g.z >= prm.nz - 1u) { return; }
	let sxy = prm.nx * prm.ny;
	let i = g.x + prm.nx * (g.y + prm.ny * g.z);
	let c = coef[i];
	if (c.x == 0.0) { return; }
	let s = p1[i + 1u] + p1[i - 1u] + p1[i + prm.nx] + p1[i - prm.nx] + p1[i + sxy] + p1[i - sxy];
	var v = (c.y * p1[i] + prm.l2 * s - c.z * p0[i]) * c.x;
	if (i == prm.src && st.step < prm.pulseLen) { v = v + pulse[st.step]; }
	p2[i] = v;
}

@group(0) @binding(6) var<storage, read> recIdx: array<u32>;      // [receptores…, celdas del plano…]
@group(0) @binding(7) var<storage, read_write> recOut: array<f32>; // [receptores × pasos | plano × muestras]

@compute @workgroup_size(64)
fn record(@builtin(global_invocation_id) g: vec3u) {
	let k = g.x;
	if (k < prm.nRcv) {
		recOut[k * prm.nSteps + st.step] = p2[recIdx[k]];
		return;
	}
	let c = k - prm.nRcv;
	if (c >= prm.nPlane || (st.step % prm.decim) != 0u) { return; }
	let m = st.step / prm.decim;
	if (m < prm.nSamplesPlane) {
		recOut[prm.nRcv * prm.nSteps + c * prm.nSamplesPlane + m] = p2[recIdx[k]];
	}
}
`;

let devicePromise: Promise<GPUDevice | null> | null = null;
let software = false;

/** true si la "GPU" es una emulación por software (SwiftShader, llvmpipe, adaptador básico de Microsoft):
 *  ahí el procesador con JavaScript es bastante más rápido. */
export const isSoftwareGpu = () => software;

/** Dispositivo WebGPU (o null si no hay). Se pide una sola vez por worker. */
export function getDevice(): Promise<GPUDevice | null> {
	if (devicePromise) return devicePromise;
	devicePromise = (async () => {
		const gpu = (globalThis.navigator as Navigator & { gpu?: GPU }).gpu;
		if (!gpu) return null;
		const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
		if (!adapter) return null;
		const info = adapter.info as GPUAdapterInfo & { isFallbackAdapter?: boolean };
		const desc = `${info?.vendor ?? ''} ${info?.architecture ?? ''} ${info?.description ?? ''}`.toLowerCase();
		software = !!info?.isFallbackAdapter || !!(adapter as GPUAdapter & { isFallbackAdapter?: boolean }).isFallbackAdapter ||
			/swiftshader|llvmpipe|lavapipe|basic render|software/.test(desc);
		const lim = adapter.limits;
		return adapter.requestDevice({
			requiredLimits: {
				maxStorageBufferBindingSize: lim.maxStorageBufferBindingSize,
				maxBufferSize: lim.maxBufferSize,
			}
		});
	})().catch(() => null);
	return devicePromise;
}

export async function gpuInfo(): Promise<string | null> {
	const gpu = (globalThis.navigator as Navigator & { gpu?: GPU }).gpu;
	if (!gpu) return null;
	const a = await gpu.requestAdapter({ powerPreference: 'high-performance' }).catch(() => null);
	if (!a) return null;
	const i = a.info;
	return [i?.vendor, i?.architecture, i?.description].filter(Boolean).join(' ') || 'GPU';
}

function nearestAir(grid: Grid, p: V3): number {
	const [x0, y0, z0] = cellOf(grid, p);
	for (let r = 0; r < 8; r++)
		for (let dz = -r; dz <= r; dz++)
			for (let dy = -r; dy <= r; dy++)
				for (let dx = -r; dx <= r; dx++) {
					if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
					const x = x0 + dx, y = y0 + dy, z = z0 + dz;
					if (x < 0 || y < 0 || z < 0 || x >= grid.nx || y >= grid.ny || z >= grid.nz) continue;
					const i = idx(grid, x, y, z);
					if (grid.air[i]) return i;
				}
	throw new Error('Un punto (altavoz u oyente) queda fuera del aire de la sala.');
}

/** Coeficientes por celda (vec4) para la GPU, a partir de la preparación de contornos. */
export function coefArray(prep: Prepared): Float32Array {
	const N = prep.grid.air.length;
	const c = new Float32Array(N * 4);
	for (const i of prep.interior) {
		c[i * 4] = 1;
		c[i * 4 + 1] = 0;
		c[i * 4 + 2] = 1;
	}
	for (let k = 0; k < prep.bnd.length; k++) {
		const i = prep.bnd[k];
		c[i * 4] = prep.bA[k];
		c[i * 4 + 1] = prep.bB[k];
		c[i * 4 + 2] = prep.bC[k];
	}
	return c;
}

export interface GpuContext {
	device: GPUDevice;
	coefBuf: GPUBuffer;
	N: number;
	prep: Prepared;
}

/** Sube la rejilla a la GPU (una vez por nivel de detalle; se reutiliza para todas las fuentes). */
export function uploadGrid(device: GPUDevice, prep: Prepared): GpuContext {
	const coef = coefArray(prep);
	const coefBuf = device.createBuffer({ size: coef.byteLength, usage: BU.STORAGE | BU.COPY_DST });
	device.queue.writeBuffer(coefBuf, 0, coef);
	return { device, coefBuf, N: prep.grid.air.length, prep };
}

export function destroyGrid(ctx: GpuContext) {
	ctx.coefBuf.destroy();
}

let pipelines: { update: GPUComputePipeline; record: GPUComputePipeline; layout0: GPUBindGroupLayout; layout1: GPUBindGroupLayout } | null = null;

function getPipelines(device: GPUDevice) {
	if (pipelines) return pipelines;
	const module = device.createShaderModule({ code: WGSL });
	const st = (b: number, type: GPUBufferBindingType): GPUBindGroupLayoutEntry => ({ binding: b, visibility: STAGE_COMPUTE, buffer: { type } });
	const layout0 = device.createBindGroupLayout({
		entries: [
			st(0, 'uniform'), st(1, 'read-only-storage'), st(2, 'read-only-storage'), st(3, 'read-only-storage'),
			st(4, 'read-only-storage'), st(5, 'storage'), st(6, 'read-only-storage'), st(7, 'storage')
		]
	});
	const layout1 = device.createBindGroupLayout({
		entries: [{ binding: 0, visibility: STAGE_COMPUTE, buffer: { type: 'uniform', hasDynamicOffset: true } }]
	});
	const layout = device.createPipelineLayout({ bindGroupLayouts: [layout0, layout1] });
	pipelines = {
		update: device.createComputePipeline({ layout, compute: { module, entryPoint: 'update' } }),
		record: device.createComputePipeline({ layout, compute: { module, entryPoint: 'record' } }),
		layout0, layout1
	};
	return pipelines;
}

/** Simulación de una fuente en la GPU. Misma interfaz y misma salida que run() del procesador. */
export async function runGpu(ctx: GpuContext, inp: Omit<RunInput, 'prep'> & { isCancelled?: () => boolean }): Promise<RunOutput> {
	const { device, prep } = ctx;
	const g = prep.grid;
	const N = ctx.N;
	const pulse = sourcePulse(prep.fs, inp.fmax);
	const steps = Math.ceil(inp.durationS * prep.fs) + pulse.length;
	const src = nearestAir(g, inp.source);
	const rcv = inp.receivers.map((r) => nearestAir(g, r));
	const nx = g.nx, ny = g.ny, sxy = nx * ny;
	const toXYZ = (i: number): V3 => [i % nx, Math.floor(i / nx) % ny, Math.floor(i / sxy)];

	// plano de mapas
	let planeCells: number[] = [], ixs: number[] = [], izs: number[] = [];
	let decim = 1, nS = 1, yc = 0;
	if (inp.planeY !== null) {
		yc = Math.min(g.ny - 2, Math.max(1, Math.floor((inp.planeY - g.origin[1]) / g.dx)));
		for (let z = 0; z < g.nz; z++)
			for (let x = 0; x < g.nx; x++) {
				const i = idx(g, x, yc, z);
				if (g.air[i]) { planeCells.push(i); ixs.push(x); izs.push(z); }
			}
		decim = Math.max(1, Math.floor(prep.fs / (2.6 * inp.fmax)));
		nS = Math.floor(steps / decim);
	}
	const nPlane = planeCells.length;

	const pl = getPipelines(device);
	const mk = (size: number, usage: number) => device.createBuffer({ size: Math.max(16, Math.ceil(size / 4) * 4), usage });
	const S = BU.STORAGE, CD = BU.COPY_DST, CS = BU.COPY_SRC;
	const pBufs = [0, 1, 2].map(() => mk(N * 4, S | CD));
	const pulseBuf = mk(pulse.byteLength, S | CD);
	device.queue.writeBuffer(pulseBuf, 0, pulse);
	const recIdxBuf = mk((rcv.length + nPlane) * 4, S | CD);
	device.queue.writeBuffer(recIdxBuf, 0, Uint32Array.from([...rcv, ...planeCells]));
	const rcvFloats = rcv.length * steps;
	const recOutBuf = mk((rcvFloats + nPlane * nS) * 4, S | CS);
	const prmBuf = mk(48, BU.UNIFORM | CD);
	const prm = new ArrayBuffer(48);
	const u = new Uint32Array(prm);
	u.set([g.nx, g.ny, g.nz, src, pulse.length, rcv.length, nPlane, decim, steps, nS]);
	new Float32Array(prm)[10] = LAMBDA * LAMBDA;
	device.queue.writeBuffer(prmBuf, 0, prm);

	// contador de paso por desplazamiento dinámico: un hueco de 256 bytes por paso dentro del bloque
	const CHUNK = 256;
	const stepBuf = mk(CHUNK * 256, BU.UNIFORM | CD);
	const stepBG = device.createBindGroup({ layout: pl.layout1, entries: [{ binding: 0, resource: { buffer: stepBuf, size: 16 } }] });
	// tres rotaciones de (p0, p1, p2)
	const bgs = [0, 1, 2].map((r) =>
		device.createBindGroup({
			layout: pl.layout0,
			entries: [
				{ binding: 0, resource: { buffer: prmBuf } }, { binding: 1, resource: { buffer: ctx.coefBuf } },
				{ binding: 2, resource: { buffer: pulseBuf } }, { binding: 3, resource: { buffer: pBufs[r % 3] } },
				{ binding: 4, resource: { buffer: pBufs[(r + 1) % 3] } }, { binding: 5, resource: { buffer: pBufs[(r + 2) % 3] } },
				{ binding: 6, resource: { buffer: recIdxBuf } }, { binding: 7, resource: { buffer: recOutBuf } }
			]
		})
	);
	const wg: [number, number, number] = [Math.ceil(g.nx / 8), Math.ceil(g.ny / 8), Math.ceil(g.nz / 4)];
	const recThreads = rcv.length + nPlane;
	const stepData = new Uint32Array(CHUNK * 64);
	try {
		for (let n0 = 0; n0 < steps; n0 += CHUNK) {
			if (inp.isCancelled?.()) throw new Error('cancelado');
			const cnt = Math.min(CHUNK, steps - n0);
			for (let k = 0; k < cnt; k++) stepData[k * 64] = n0 + k;
			device.queue.writeBuffer(stepBuf, 0, stepData, 0, cnt * 64);
			const enc = device.createCommandEncoder();
			for (let k = 0; k < cnt; k++) {
				const n = n0 + k;
				const pass = enc.beginComputePass();
				pass.setBindGroup(0, bgs[n % 3]);
				pass.setBindGroup(1, stepBG, [k * 256]);
				pass.setPipeline(pl.update);
				pass.dispatchWorkgroups(wg[0], wg[1], wg[2]);
				pass.setPipeline(pl.record);
				pass.dispatchWorkgroups(Math.ceil(recThreads / 64));
				pass.end();
			}
			device.queue.submit([enc.finish()]);
			await device.queue.onSubmittedWorkDone();
			inp.onProgress?.((n0 + cnt) / steps);
		}
		// lectura de resultados
		const total = rcvFloats + nPlane * nS;
		const readBuf = mk(total * 4, BU.MAP_READ | CD);
		const enc = device.createCommandEncoder();
		enc.copyBufferToBuffer(recOutBuf, 0, readBuf, 0, total * 4);
		device.queue.submit([enc.finish()]);
		await readBuf.mapAsync(MAP_READ);
		const all = new Float32Array(readBuf.getMappedRange().slice(0, total * 4));
		readBuf.unmap();
		readBuf.destroy();
		const allRcv = all.subarray(0, rcvFloats);
		const planeData = all.slice(rcvFloats);
		return {
			fs: prep.fs, pulse, K: g.dx / (4 * Math.PI * LAMBDA * LAMBDA),
			irs: rcv.map((_, r) => allRcv.slice(r * steps, (r + 1) * steps)),
			receiverCells: rcv.map(toXYZ),
			plane: inp.planeY === null ? null : {
				decim, fsPlane: prep.fs / decim, nSamples: nS, ix: Int32Array.from(ixs), iz: Int32Array.from(izs),
				data: planeData, nx: g.nx, nz: g.nz, y: yc
			},
			sourceCell: toXYZ(src)
		};
	} finally {
		for (const b of [...pBufs, pulseBuf, recIdxBuf, recOutBuf, prmBuf, stepBuf]) b.destroy();
	}
}
