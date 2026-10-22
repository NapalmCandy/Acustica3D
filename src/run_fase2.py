"""Fase 2: calibración, mapas de distorsión y límites de extensión del grave."""
import json, os, sys
import numpy as np
from multiprocessing import Pool
sys.path.insert(0, os.path.dirname(__file__))
import kh120a_model as m
import nl_tools as nt

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATOS = os.path.join(BASE, "datos")

F_GRID = np.round(np.geomspace(20, 400, 34), 2)
L_GRID = np.arange(75, 105.01, 2.5)
ESCENARIOS = {"conservador": {}, "optimista": m.OPTIMISTA}


def params(esc):
    p = dict(m.P)
    p.update(ESCENARIOS[esc])
    return p


def _cell(args):
    esc, f, L = args
    p = params(esc)
    r = nt.at_spl(p, f, L, m.pack(p), m.make_dcorr(p))
    return esc, f, L, r


def _maxspl(args):
    esc, f = args
    p = params(esc)
    s, V = nt.max_spl_thd(p, f, 3.0, m.pack(p), m.make_dcorr(p), lo=80, hi=112)
    return esc, f, s


def ext_limit(grid, L, thr, V_lim):
    """Frecuencia más baja tal que, desde ahí hasta 200 Hz, THD <= thr y V <= V_lim al nivel L."""
    li = int(np.argmin(abs(L_GRID - L)))
    ok = []
    for fi, f in enumerate(F_GRID):
        V, spl, h2, h3, thd = grid[fi, li, :5]
        ok.append(thd <= thr and V <= V_lim and abs(spl - L) < 0.5)
    ok = np.array(ok)
    sel = F_GRID <= 200
    idx = np.where(sel)[0]
    lim = None
    for i in idx[::-1]:
        if ok[i]:
            lim = F_GRID[i]
        else:
            break
    if lim is None:
        return None
    # interpolación log entre el último punto malo y el primero bueno usando THD
    i = int(np.where(F_GRID == lim)[0][0])
    if i == 0:
        return float(lim)
    a, b = grid[i - 1, li], grid[i, li]
    ma = max(a[4] / thr, a[0] / V_lim)
    mb = max(b[4] / thr, b[0] / V_lim)
    if ma > 1 >= mb:
        t = np.log(ma) / (np.log(ma) - np.log(mb))
        return float(np.exp(np.log(F_GRID[i - 1]) + t * (np.log(F_GRID[i]) - np.log(F_GRID[i - 1]))))
    return float(lim)


if __name__ == "__main__":
    os.makedirs(DATOS, exist_ok=True)
    jobs = [(e, f, L) for e in ESCENARIOS for f in F_GRID for L in L_GRID]
    with Pool(4) as pool:
        res = pool.map(_cell, jobs, chunksize=4)
        cal = pool.map(_maxspl, [(e, f) for e in ESCENARIOS for f in np.geomspace(50, 100, 6)])
    out = {"F_GRID": F_GRID.tolist(), "L_GRID": L_GRID.tolist(), "cols": ["V", "spl", "H2", "H3", "THD", "x_mm", "vport"]}
    for e in ESCENARIOS:
        g = np.zeros((len(F_GRID), len(L_GRID), 7))
        for esc, f, L, r in res:
            if esc == e:
                g[list(F_GRID).index(f), list(L_GRID).index(L)] = r
        np.save(os.path.join(DATOS, f"mapa_nl_{e}.npy"), g)
        p = params(e)
        tab = {}
        for L in [80, 85, 90, 95, 100]:
            tab[str(L)] = {thr: ext_limit(g, L, thr, p["V_lim"]) for thr in (1.0, 3.0)}
        ms = [s for esc, f, s in cal if esc == e]
        out[e] = {"limites": tab, "maxspl3_50_100_4pi": float(np.mean(ms)), "maxspl3_puntos": ms,
                  "thd_89dB_120_400": {str(f): float(g[i, list(L_GRID).index(87.5), 4]) for i, f in enumerate(F_GRID) if f >= 120}}
    d = m.derived(m.P)
    out["parametros"] = {k: (v if not isinstance(v, tuple) else list(v)) for k, v in m.P.items()}
    out["derivados"] = {k: float(v) for k, v in d.items()}
    with open(os.path.join(DATOS, "fase2_resultados.json"), "w") as fh:
        json.dump(out, fh, indent=1)
    for e in ESCENARIOS:
        print(e, "max SPL 3% media 50-100 (4π):", round(out[e]["maxspl3_50_100_4pi"], 1), "dB  (+6 =", round(out[e]["maxspl3_50_100_4pi"] + 6, 1), "semiespacio)")
        for L, v in out[e]["limites"].items():
            print("  ", L, "dB:", {k: (round(x, 1) if x else None) for k, x in v.items()})
