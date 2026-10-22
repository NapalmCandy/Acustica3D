"""
Corrección de sala por debajo de ~300 Hz: SOLO RECORTA PICOS, nunca realza huecos.
Se usará cuando haya medidas en la posición de escucha (exportación de texto de REW).

Uso previsto (cuando lleguen las medidas):
    f, spl = load_rew_txt("L_escucha_promedio.txt")
    g_db = room_cut_db(f, spl)                  # ganancia de corrección (<= 0 dB)
    h = room_fir_minphase(g_db, f, fs=48000)    # FIR de fase mínima (los modos de sala son de fase mínima)
El FIR definitivo será la convolución de este filtro con la corrección del altavoz (fir_design.py).
"""
import numpy as np


def load_rew_txt(path):
    """Lee 'File > Export > Export measurement as text' de REW (freq, SPL, fase)."""
    rows = []
    with open(path, encoding="utf-8", errors="ignore") as fh:
        for line in fh:
            line = line.strip()
            if not line or line[0] in "*#" or not (line[0].isdigit() or line[0] == "."):
                continue
            parts = line.replace(",", " ").split()
            try:
                rows.append([float(x) for x in parts[:3]])
            except ValueError:
                continue
    a = np.array(rows)
    return a[:, 0], a[:, 1]


def smooth_oct(f, db, frac=6):
    """Suavizado en potencia a 1/frac de octava."""
    p = 10 ** (db / 10)
    out = np.empty_like(db)
    for i, fc in enumerate(f):
        sel = (f >= fc * 2 ** (-0.5 / frac)) & (f <= fc * 2 ** (0.5 / frac))
        out[i] = 10 * np.log10(p[sel].mean())
    return out


def room_cut_db(f, spl, f_max=300.0, f_fade=(250.0, 350.0), ref_band=(300.0, 1000.0),
                frac=6, max_cut=10.0, f_min=25.0):
    """Ganancia (dB) que recorta los picos por encima del nivel de referencia por debajo de f_max.
    Nunca devuelve realce (> 0 dB): los huecos de sala no se corrigen con ecualización."""
    s = smooth_oct(f, spl, frac)
    ref = np.mean(s[(f >= ref_band[0]) & (f <= ref_band[1])])
    g = np.minimum(0.0, ref - s)
    g = np.maximum(g, -max_cut)
    w = np.clip((f_fade[1] - f) / (f_fade[1] - f_fade[0]), 0, 1)   # 1 por debajo de 250 Hz, 0 por encima de 350 Hz
    w[f < f_min] = 0.0                                                # no tocar el subgrave
    return g * w


def room_fir_minphase(g_db, f_meas, fs=48000, n=16384):
    """FIR de fase mínima a partir de la curva de recorte."""
    ff = np.fft.rfftfreq(n, 1 / fs)
    gi = np.interp(ff, f_meas, g_db, left=0.0, right=0.0)
    logm = np.log(10 ** (gi / 20))
    cep = np.fft.irfft(logm, n)
    fold = np.zeros(n)
    fold[0] = cep[0]
    fold[1:n // 2] = 2 * cep[1:n // 2]
    fold[n // 2] = cep[n // 2]
    H = np.exp(np.fft.rfft(fold, n))
    h = np.fft.irfft(H, n)
    k = n // 8
    h[-k:] *= 0.5 + 0.5 * np.cos(np.pi * np.arange(k) / k)
    return h


if __name__ == "__main__":
    # autocomprobación con una sala sintética: modo de +8 dB a 57 Hz y hueco de -15 dB a 110 Hz
    f = np.geomspace(15, 2000, 800)
    spl = 85 + 8 * np.exp(-0.5 * (np.log2(f / 57) / 0.08) ** 2) - 15 * np.exp(-0.5 * (np.log2(f / 110) / 0.05) ** 2)
    g = room_cut_db(f, spl)
    for fc in (40, 57, 80, 110, 200, 400):
        i = np.argmin(abs(f - fc))
        print(f"{fc:4d} Hz: medida {spl[i]-85:+5.1f} dB -> corrección {g[i]:+5.1f} dB")
    assert g.max() <= 0.0
    print("OK: solo recorta, nunca realza")
