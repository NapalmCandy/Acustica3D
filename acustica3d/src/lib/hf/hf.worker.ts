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
	/** eje de cada KH y absorción de cada material por octava (HF_OCTAVES): para no calcular la
	 *  difracción de caminos que no van a llegar a nada */
	aims: Record<string, V3>;
	alpha: number[][];
}
export type HfReply = { reqId: number; paths: Path[]; ms: number } | { reqId: number; error: string };

self.onmessage = (ev: MessageEvent<HfRequest>) => {
	const r = ev.data;
	const t0 = performance.now();
	try {
		const paths = findPaths(r.tris, r.triMat, r.sources, r.ear, { maxOrder: r.maxOrder, prune: { aim: r.aims, alpha: r.alpha, minDb: -30 } });
		(self as unknown as Worker).postMessage({ reqId: r.reqId, paths, ms: performance.now() - t0 } satisfies HfReply);
	} catch (e) {
		(self as unknown as Worker).postMessage({ reqId: r.reqId, error: e instanceof Error ? e.message : String(e) } satisfies HfReply);
	}
};
