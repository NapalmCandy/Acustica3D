"""Barridos no lineales: THD/H2/H3 en función de la frecuencia y el nivel."""
import numpy as np
import kh120a_model as m


def sweep_level(p, f, Vs, pr=None, Dc=None):
    if pr is None:
        pr = m.pack(p)
    out = np.array([m.tone(p, f, V, pr=pr, Dcorr=Dc) for V in Vs])
    return out  # columnas: spl, h2, h3, thd, xpk, vport


def at_spl(p, f, spl_target, pr=None, Dc=None, iters=6):
    """Ajusta la tensión hasta conseguir el SPL pedido (4π, 1 m) y devuelve (V, spl, h2, h3, thd, x, vport)."""
    if pr is None:
        pr = m.pack(p)
    # estimación lineal inicial
    pf, _ = m.p_2pi_per_volt(np.array([f]), p)
    D = Dc(np.array([f]))[0] if Dc is not None else 1.0
    p_per_v = abs(pf[0]) * 0.5 * D
    V = np.sqrt(2) * 2e-5 * 10 ** (spl_target / 20) / p_per_v
    r = None
    for _ in range(iters):
        r = m.tone(p, f, V, pr=pr, Dcorr=Dc)
        err = spl_target - r[0]
        if abs(err) < 0.02:
            break
        V *= 10 ** (err / 20)
        if V > 3 * p["V_clip"]:
            break
    return (V,) + tuple(r)


def max_spl_thd(p, f, thr, pr=None, Dc=None, lo=60, hi=118):
    """SPL máximo (4π, 1 m) con THD <= thr (%), por bisección. Devuelve (spl, V)."""
    if pr is None:
        pr = m.pack(p)
    a, b = lo, hi
    Va = None
    for _ in range(14):
        mid = 0.5 * (a + b)
        r = at_spl(p, f, mid, pr, Dc, iters=5)
        V, spl, h2, h3, thd = r[:5]
        ok = (thd <= thr) and abs(spl - mid) < 0.3
        if ok:
            a, Va = mid, V
        else:
            b = mid
        if b - a < 0.1:
            break
    return a, Va
