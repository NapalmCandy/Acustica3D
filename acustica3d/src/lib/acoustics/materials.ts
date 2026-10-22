// Biblioteca de materiales acústicos y conversión a admitancia para la simulación de ondas.
// Coeficientes de absorción en incidencia aleatoria por bandas de octava (63 Hz – 8 kHz),
// valores típicos de tablas de referencia. Son ESTIMACIONES: se ajustarán con medidas (calibración).

export const OCTAVES = [63, 125, 250, 500, 1000, 2000, 4000, 8000] as const;

export type MaterialKind = 'table' | 'porous' | 'ignore';

export interface PorousParams {
	thickness_mm: number; // grosor de la lana de roca
	density_kgm3: number; // densidad nominal
	airgap_mm: number; // cámara de aire detrás del panel
	/** resistividad al flujo (Pa·s/m²) de la ficha del producto; si no se da, se estima por la densidad */
	flowRes?: number;
}

export interface AcousticMaterial {
	id: string;
	name: string;
	kind: MaterialKind;
	alpha: number[]; // 8 bandas (para 'table'); para 'porous' se calcula
	note?: string;
	porous?: PorousParams;
	color: string; // color en la vista 3D
}

export const LIBRARY: AcousticMaterial[] = [
	{ id: 'pladur_trasdosado', name: 'Trasdosado de pladur con lana de roca', kind: 'table',
	  alpha: [0.25, 0.28, 0.12, 0.06, 0.05, 0.05, 0.06, 0.06], color: '#d8d4cc',
	  note: 'Pladur 12,5–15 mm sobre perfilería con lana mineral delante del ladrillo: absorbe algo de grave por membrana.' },
	{ id: 'pladur_camara', name: 'Trasdosado de pladur con cámara sin lana', kind: 'table',
	  alpha: [0.12, 0.25, 0.1, 0.05, 0.04, 0.05, 0.06, 0.06], color: '#d2cec4',
	  note: 'Pladur sobre perfilería con una cámara de aire estrecha y vacía: resuena más arriba (~100 Hz) y con menos amortiguación que con lana.' },
	{ id: 'falso_techo_pladur', name: 'Falso techo de pladur (con plénum)', kind: 'table',
	  alpha: [0.2, 0.22, 0.1, 0.05, 0.04, 0.05, 0.05, 0.05], color: '#ecebe6',
	  note: 'Placa continua suspendida: membrana en graves.' },
	{ id: 'ladrillo', name: 'Ladrillo enlucido / yeso sobre obra', kind: 'table',
	  alpha: [0.01, 0.02, 0.02, 0.03, 0.04, 0.05, 0.05, 0.05], color: '#b5715a' },
	{ id: 'hormigon', name: 'Hormigón / baldosa', kind: 'table',
	  alpha: [0.01, 0.01, 0.01, 0.02, 0.02, 0.02, 0.03, 0.03], color: '#9b9b98' },
	{ id: 'tarima', name: 'Tarima / parquet flotante', kind: 'table',
	  alpha: [0.1, 0.15, 0.11, 0.1, 0.07, 0.06, 0.07, 0.07], color: '#a8805a' },
	{ id: 'alfombra', name: 'Alfombra sobre suelo duro', kind: 'table',
	  alpha: [0.02, 0.02, 0.06, 0.14, 0.37, 0.6, 0.65, 0.65], color: '#6f6a8a' },
	{ id: 'cristal', name: 'Ventana (cristal)', kind: 'table',
	  alpha: [0.3, 0.35, 0.25, 0.18, 0.12, 0.07, 0.04, 0.04], color: '#9fc6d9' },
	{ id: 'puerta', name: 'Puerta de madera', kind: 'table',
	  alpha: [0.15, 0.14, 0.1, 0.06, 0.08, 0.1, 0.1, 0.1], color: '#8a5a3b' },
	{ id: 'madera_mueble', name: 'Mueble / escritorio de madera o MDF', kind: 'table',
	  alpha: [0.1, 0.12, 0.1, 0.08, 0.08, 0.08, 0.1, 0.1], color: '#c09a6b' },
	{ id: 'pantalla', name: 'Pantalla / plástico duro', kind: 'table',
	  alpha: [0.02, 0.03, 0.03, 0.03, 0.03, 0.03, 0.02, 0.02], color: '#3a3a3f',
	  note: 'Pantalla de ordenador o televisor: superficie dura que refleja casi todo; importa sobre todo en medios y agudos.' },
	{ id: 'sofa', name: 'Sofá / sillón tapizado', kind: 'table',
	  alpha: [0.15, 0.2, 0.4, 0.55, 0.6, 0.6, 0.6, 0.6], color: '#7a6f64' },
	{ id: 'panel_lana_roca', name: 'Panel de lana de roca (calculado)', kind: 'porous', alpha: [],
	  porous: { thickness_mm: 50, density_kgm3: 70, airgap_mm: 0 }, color: '#e3c86a',
	  note: 'Se calcula con el modelo poroso de Miki a partir de grosor, densidad y cámara de aire.' },
	{ id: 'ignorar', name: 'Ignorar (no es una superficie acústica)', kind: 'ignore', alpha: [],
	  color: '#ff00ff', note: 'Para cotas, personas, lámparas, los propios altavoces del dibujo…' }
];

export const RHO = 1.204;
export const C0 = 343.0;

/** Lanas con ficha técnica conocida, por el nombre del material de SketchUp: densidad nominal y
 *  resistividad al flujo (AFr de la ficha, EN 29053). La AFr es un mínimo declarado: se usa algo por
 *  encima, que es lo típico medido para esas densidades. */
export const POROUS_PRODUCTS: { re: RegExp; name: string; density_kgm3: number; flowRes: number }[] = [
	// ROCKWOOL España, ficha de abril de 2023: 30 kg/m³, AFr5
	{ re: /sonorock[ _-]*(eco|kraft)/i, name: 'ROCKWOOL Sonorock Eco/Kraft', density_kgm3: 30, flowRes: 6000 },
	// 50 kg/m³, AFr15
	{ re: /sonorock[ _-]*plus/i, name: 'ROCKWOOL Sonorock Plus', density_kgm3: 50, flowRes: 16000 }
];

/** Densidad y resistividad de una lana por el nombre de su material (si es un producto conocido). */
export function porousProduct(name: string): { density_kgm3: number; flowRes?: number; name: string } | null {
	// la densidad escrita en el nombre («Lana de roca 80kg/m3») manda sobre la del producto
	const m = /(\d{2,3}(?:[.,]\d)?)\s*kg(?:\s*\/?\s*m(?:3|³))?/i.exec(name);
	if (m) {
		const density_kgm3 = parseFloat(m[1].replace(',', '.'));
		if (density_kgm3 >= 10 && density_kgm3 <= 250) return { name: `lana de ${density_kgm3} kg/m³`, density_kgm3 };
	}
	return POROUS_PRODUCTS.find((p) => p.re.test(name)) ?? null;
}

/** Resistividad al flujo de la lana de roca según densidad (Pa·s/m²), interpolación log-log [estimada]. */
export function flowResistivity(density: number): number {
	const pts: [number, number][] = [
		[30, 8000], [40, 12000], [50, 16000], [70, 25000], [100, 40000], [150, 70000]
	];
	const d = Math.min(150, Math.max(30, density));
	for (let i = 0; i < pts.length - 1; i++) {
		const [d0, s0] = pts[i];
		const [d1, s1] = pts[i + 1];
		if (d >= d0 && d <= d1) {
			const t = Math.log(d / d0) / Math.log(d1 / d0);
			return Math.exp(Math.log(s0) + t * Math.log(s1 / s0));
		}
	}
	return pts[pts.length - 1][1];
}

type C = { re: number; im: number };
const c = (re: number, im = 0): C => ({ re, im });
const add = (a: C, b: C): C => c(a.re + b.re, a.im + b.im);
const sub = (a: C, b: C): C => c(a.re - b.re, a.im - b.im);
const mul = (a: C, b: C): C => c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const div = (a: C, b: C): C => {
	const d = b.re * b.re + b.im * b.im;
	return c((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
};
const cexp = (a: C): C => c(Math.exp(a.re) * Math.cos(a.im), Math.exp(a.re) * Math.sin(a.im));
const ctan = (a: C): C => {
	// tan(z) = -i (e^{iz} - e^{-iz}) / (e^{iz} + e^{-iz})
	const iz = c(-a.im, a.re);
	const e1 = cexp(iz);
	const e2 = cexp(c(-iz.re, -iz.im));
	return mul(c(0, -1), div(sub(e1, e2), add(e1, e2)));
};

/** Impedancia superficial normalizada (Z/ρc) de un panel poroso (Miki) con cámara de aire, reacción local. */
export function porousSurfaceImpedance(f: number, p: PorousParams): C {
	const sigma = p.flowRes ?? flowResistivity(p.density_kgm3);
	const X = f / sigma;
	const w = 2 * Math.PI * f;
	const zc = c(1 + 0.0699 * Math.pow(X, -0.632), -0.1071 * Math.pow(X, -0.632)); // Zc/ρc
	const kc = c((w / C0) * (1 + 0.1093 * Math.pow(X, -0.618)), -(w / C0) * 0.1597 * Math.pow(X, -0.618));
	const d = p.thickness_mm / 1000;
	const D = p.airgap_mm / 1000;
	// impedancia de la cámara de aire sobre pared rígida: -j cot(k0 D); sin cámara: rígida (infinito)
	let zb: C | null = null;
	if (D > 1e-4) {
		const k0D = (w / C0) * D;
		zb = c(0, -1 / Math.tan(k0D));
	}
	const t = ctan(mul(kc, c(d)));
	if (zb === null) {
		// -j Zc cot(kc d)
		return mul(mul(c(0, -1), zc), div(c(1), t));
	}
	const jt = mul(c(0, 1), t);
	return mul(zc, div(add(zb, mul(jt, zc)), add(zc, mul(jt, zb))));
}

/** Absorción en incidencia aleatoria (integral de Paris) para una impedancia normalizada de reacción local. */
export function randomIncidenceAlpha(z: C): number {
	const N = 90;
	let acc = 0;
	for (let i = 0; i < N; i++) {
		const th = ((i + 0.5) / N) * (Math.PI / 2);
		const ct = Math.cos(th);
		const zc = mul(z, c(ct));
		const R = div(sub(zc, c(1)), add(zc, c(1)));
		const a = 1 - (R.re * R.re + R.im * R.im);
		acc += a * Math.sin(2 * th) * (Math.PI / 2 / N);
	}
	return Math.min(1, Math.max(0, acc));
}

export function porousAlphaOctaves(p: PorousParams): number[] {
	return OCTAVES.map((f) => {
		// media de tres frecuencias dentro de la octava
		const fs = [f / Math.SQRT2 ** 0.67, f, f * Math.SQRT2 ** 0.67];
		return fs.reduce((s, ff) => s + randomIncidenceAlpha(porousSurfaceImpedance(ff, p)), 0) / fs.length;
	});
}

export function materialAlpha(m: AcousticMaterial): number[] {
	if (m.kind === 'porous' && m.porous) return porousAlphaOctaves(m.porous);
	if (m.kind === 'ignore') return OCTAVES.map(() => 0);
	return m.alpha;
}

/** Admitancia normalizada real β (=ρc/Z) que da la misma absorción aleatoria α (inversión numérica). */
export function alphaToBeta(alpha: number): number {
	const a = Math.min(0.95, Math.max(0, alpha));
	if (a <= 1e-6) return 0;
	let lo = 1e-6;
	let hi = 1.0;
	// α_random(β) crece con β en [0, ~0.6]; buscamos en ese tramo
	for (let it = 0; it < 60; it++) {
		const mid = 0.5 * (lo + hi);
		const al = randomIncidenceAlpha(c(1 / mid));
		if (al < a) lo = mid;
		else hi = mid;
	}
	return 0.5 * (lo + hi);
}

/** α equivalente para la simulación de graves (frecuencia-independiente): media de las octavas <= fmax. */
export function lowFreqAlpha(alpha: number[], fmax: number): number {
	const used = OCTAVES.map((f, i) => [f, alpha[i]] as const).filter(([f]) => f <= Math.max(125, fmax));
	return used.reduce((s, [, a]) => s + a, 0) / used.length;
}
