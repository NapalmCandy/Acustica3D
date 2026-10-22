import { chromium } from 'playwright';
const flagsets = [
  ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface'],
  ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'],
  ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-features=Vulkan']
];
for (const args of flagsets) {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args });
  const p = await b.newPage();
  await p.route('https://prueba.local/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>ok</body></html>' }));
  await p.goto('https://prueba.local/');
  const r = await p.evaluate(async () => {
    if (!navigator.gpu) return 'sin navigator.gpu';
    const a = await navigator.gpu.requestAdapter();
    if (!a) return 'sin adaptador';
    const info = a.info ?? {};
    const d = await a.requestDevice();
    // prueba de cálculo: sumar 1 a 1M elementos
    const n = 1 << 20;
    const buf = d.createBuffer({ size: n * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const rb = d.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const mod = d.createShaderModule({ code: `@group(0) @binding(0) var<storage, read_write> a: array<f32>;
      @compute @workgroup_size(256) fn main(@builtin(global_invocation_id) g: vec3u) { if (g.x < arrayLength(&a)) { a[g.x] = f32(g.x) * 0.5; } }` });
    const pl = d.createComputePipeline({ layout: 'auto', compute: { module: mod, entryPoint: 'main' } });
    const bg = d.createBindGroup({ layout: pl.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: buf } }] });
    const enc = d.createCommandEncoder();
    const pass = enc.beginComputePass(); pass.setPipeline(pl); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(n / 256); pass.end();
    enc.copyBufferToBuffer(buf, 4 * 1000, rb, 0, 16);
    d.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const v = Array.from(new Float32Array(rb.getMappedRange()));
    return `OK adaptador ${info.vendor ?? '?'} ${info.architecture ?? ''} ${info.description ?? ''} → ${v.join(',')}`;
  }).catch((e) => 'error: ' + e.message);
  console.log(args.join(' '), '\n   ', r);
  await b.close();
}
