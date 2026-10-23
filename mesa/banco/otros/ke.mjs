// |F(v)| de la difracción en un borde (Fresnel–Kirchhoff) y la cobertura de Cauchy equivalente
const C = (x) => { let s = 0, n = 4000; for (let i = 0; i < n; i++) { const t = (i + 0.5) * x / n; s += Math.cos(Math.PI * t * t / 2); } return s * x / n; };
const S = (x) => { let s = 0, n = 4000; for (let i = 0; i < n; i++) { const t = (i + 0.5) * x / n; s += Math.sin(Math.PI * t * t / 2); } return s * x / n; };
for (let v = -3; v <= 3.01; v += 0.25) {
  const c = C(v), s = S(v);
  const F = Math.hypot(0.5 - c, 0.5 - s) / Math.SQRT2;
  const cov = 0.5 + Math.atan(-v * Math.SQRT2) / Math.PI;
  console.log(v.toFixed(2), F.toFixed(3), (20*Math.log10(F)).toFixed(1), 'cauchy', cov.toFixed(3));
}
