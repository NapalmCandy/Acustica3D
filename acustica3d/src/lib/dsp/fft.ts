// FFT radix-2 compleja in-place (re, im) y utilidades. Suficiente para respuestas de sala (N <= 2^20).

export function nextPow2(n: number): number {
	let p = 1;
	while (p < n) p <<= 1;
	return p;
}

export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
	const n = re.length;
	for (let i = 1, j = 0; i < n; i++) {
		let bit = n >> 1;
		for (; j & bit; bit >>= 1) j ^= bit;
		j ^= bit;
		if (i < j) {
			[re[i], re[j]] = [re[j], re[i]];
			[im[i], im[j]] = [im[j], im[i]];
		}
	}
	for (let len = 2; len <= n; len <<= 1) {
		const ang = ((inverse ? 2 : -2) * Math.PI) / len;
		const wr = Math.cos(ang);
		const wi = Math.sin(ang);
		for (let i = 0; i < n; i += len) {
			let cr = 1;
			let ci = 0;
			for (let k = 0; k < len / 2; k++) {
				const a = i + k;
				const b = a + len / 2;
				const xr = re[b] * cr - im[b] * ci;
				const xi = re[b] * ci + im[b] * cr;
				re[b] = re[a] - xr;
				im[b] = im[a] - xi;
				re[a] += xr;
				im[a] += xi;
				const t = cr * wr - ci * wi;
				ci = cr * wi + ci * wr;
				cr = t;
			}
		}
	}
	if (inverse) {
		for (let i = 0; i < n; i++) {
			re[i] /= n;
			im[i] /= n;
		}
	}
}

/** Espectro de una señal real (rellenada con ceros hasta n). Devuelve n/2+1 bins. */
export function rfft(x: ArrayLike<number>, n: number): { re: Float64Array; im: Float64Array } {
	const re = new Float64Array(n);
	const im = new Float64Array(n);
	for (let i = 0; i < Math.min(n, x.length); i++) re[i] = x[i];
	fft(re, im);
	return { re: re.slice(0, n / 2 + 1), im: im.slice(0, n / 2 + 1) };
}

/** Inversa de un espectro hermítico de n/2+1 bins → señal real de n muestras. */
export function irfft(Re: Float64Array, Im: Float64Array, n: number): Float64Array {
	const re = new Float64Array(n);
	const im = new Float64Array(n);
	for (let k = 0; k <= n / 2; k++) {
		re[k] = Re[k];
		im[k] = Im[k];
	}
	for (let k = 1; k < n / 2; k++) {
		re[n - k] = Re[k];
		im[n - k] = -Im[k];
	}
	fft(re, im, true);
	return re;
}
