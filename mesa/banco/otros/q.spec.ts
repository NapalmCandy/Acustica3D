import { it, expect } from 'vitest';
import { KH_Q, HF_OCTAVES } from '/home/user/acustica3d/acustica3d/src/lib/hf/imageSource';
it('q', () => { console.log('Q', HF_OCTAVES.map((f, i) => `${f}:${KH_Q[i].toFixed(1)} (DI ${(10*Math.log10(KH_Q[i])).toFixed(1)} dB)`).join('  ')); expect(1).toBe(1); });
