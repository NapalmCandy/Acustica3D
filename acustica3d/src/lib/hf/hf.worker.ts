/// <reference lib="webworker" />
// Worker de medios y agudos: busca las reflexiones (imageSource.ts) sin bloquear la interfaz.
import { findPaths, type Path } from './imageSource';
import type { V3 } from '../sim/voxel';

export interface HfRequest {
	reqId: number;
	tris: Float32Array;
	triMat: Int32Array;
	sources: { id: string; pos: V3 }[];
	ear: V3;
	maxOrder: number;
}
export type HfReply = { reqId: number; paths: Path[]; ms: number } | { reqId: number; error: string };

self.onmessage = (ev: MessageEvent<HfRequest>) => {
	const r = ev.data;
	const t0 = performance.now();
	try {
		const paths = findPaths(r.tris, r.triMat, r.sources, r.ear, { maxOrder: r.maxOrder });
		(self as unknown as Worker).postMessage({ reqId: r.reqId, paths, ms: performance.now() - t0 } satisfies HfReply);
	} catch (e) {
		(self as unknown as Worker).postMessage({ reqId: r.reqId, error: e instanceof Error ? e.message : String(e) } satisfies HfReply);
	}
};
