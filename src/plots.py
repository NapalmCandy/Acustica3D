"""Gráficas: modelo, original frente a corregido, distorsión. Resolución de 1/12 de octava."""
import json, os, sys
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter
from scipy.io import wavfile
sys.path.insert(0, os.path.dirname(__file__))
import kh120a_model as m
import fir_design as fd

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
G = os.path.join(BASE, "graficas")
DATOS = os.path.join(BASE, "datos")
FILT = os.path.join(BASE, "filtros")

# paleta de referencia (validada): azul, naranja, aguamarina
C_ORIG, C_FL, C_BL = "#eb6834", "#2a78d6", "#1baf7a"
SEQ = ["#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#104281"]   # rampa secuencial azul
INK, INK2, GRID = "#0b0b0b", "#52514e", "#e4e3df"
PROV = "PROVISIONAL – modelo calibrado con datos publicados, sin medidas propias"

plt.rcParams.update({
    "font.size": 10, "axes.edgecolor": INK2, "axes.labelcolor": INK, "xtick.color": INK2,
    "ytick.color": INK2, "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.7,
    "axes.spines.top": False, "axes.spines.right": False, "legend.frameon": False,
    "lines.linewidth": 1.8, "figure.facecolor": "#fcfcfb", "axes.facecolor": "#fcfcfb",
    "savefig.facecolor": "#fcfcfb",
})


def hz_fmt(x, _):
    return f"{x/1000:g}k" if x >= 1000 else f"{x:g}"


def logx(ax, lo=10, hi=24000):
    from matplotlib.ticker import NullFormatter, FixedLocator
    ax.set_xscale("log")
    ticks = [t for t in (10, 20, 30, 40, 50, 60, 80, 100, 150, 200, 300, 400, 500, 1000, 2000, 5000, 10000, 20000)
             if lo <= t <= hi]
    if hi / lo > 300:
        ticks = [t for t in (10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000) if lo <= t <= hi]
    ax.set_xlim(lo, hi)
    ax.xaxis.set_major_locator(FixedLocator(ticks))
    ax.xaxis.set_major_formatter(FuncFormatter(hz_fmt))
    ax.xaxis.set_minor_formatter(NullFormatter())
    ax.set_xlabel("Frecuencia (Hz)")


def oct12(fs):
    return np.geomspace(10, fs / 2 * 0.999, int(np.log2(fs / 2 / 10) * 12) + 1)


def smooth_mag(f_lin, H, f_pts, frac=12):
    """Suavizado en potencia a 1/frac de octava, evaluado en f_pts."""
    out = np.empty(len(f_pts))
    p = np.abs(H) ** 2
    cs = np.concatenate([[0], np.cumsum(p)])
    for i, fc in enumerate(f_pts):
        lo, hi = fc * 2 ** (-0.5 / frac), fc * 2 ** (0.5 / frac)
        a, b = np.searchsorted(f_lin, lo), np.searchsorted(f_lin, hi)
        if b <= a:
            out[i] = p[min(a, len(p) - 1)]
        else:
            out[i] = (cs[b] - cs[a]) / (b - a)
    return 10 * np.log10(np.maximum(out, 1e-30))


def sample(f_lin, y, f_pts):
    return np.interp(f_pts, f_lin, y)


def load_filters(var, fs=48000):
    khz = "48k" if fs == 48000 else "44k1"
    _, hfl = wavfile.read(os.path.join(FILT, f"KH120A_PROVISIONAL_{var}_faselineal_{khz}.wav"))
    _, hbl = wavfile.read(os.path.join(FILT, f"KH120A_PROVISIONAL_{var}_bajalatencia_{khz}.wav"))
    return hfl[:, 0].astype(float), hbl[:, 0].astype(float)


def systems(var, info, fs=48000):
    f = fd.grid(fs)
    H, *_ = fd.system_H(f)
    hfl, hbl = load_filters(var, fs)
    att = 10 ** (info.get("atenuacion_total_dB", info["atenuacion_previa_dB"]) / 20)
    lat_fl = (len(hfl) // 2) / fs
    lat_bl = info["latencia_BL_ms"] * 1e-3
    Sfl = H * fd.resp(hfl, fs) * att * np.exp(1j * 2 * np.pi * f * lat_fl)
    Sbl = H * fd.resp(hbl, fs) * att * np.exp(1j * 2 * np.pi * f * lat_bl)
    return f, {"Original (KH 120 A de serie)": H, "Corregido – fase lineal": Sfl, "Corregido – baja latencia": Sbl}, (lat_fl, lat_bl)


COLS = {"Original (KH 120 A de serie)": C_ORIG, "Corregido – fase lineal": C_FL, "Corregido – baja latencia": C_BL}
TIT = {"LIN50": "LIN50 – sin extensión (−3 dB a 50 Hz, 36 dB/oct)", "EXT40": "EXT40 – grave extendido (−3 dB a 40 Hz, 36 dB/oct)"}


def fig_freq(info_all, kind):
    fs = 48000
    fig, axs = plt.subplots(1, 2, figsize=(13, 4.8), sharey=True)
    for ax, var in zip(axs, ["LIN50", "EXT40"]):
        info = info_all[f"{var}_48k"]
        f, S, lats = systems(var, info, fs)
        fp = oct12(fs)
        for name, Hs in S.items():
            if kind == "mag":
                y = smooth_mag(f, Hs, fp)
            elif kind == "phase":
                ph = np.degrees(np.unwrap(np.angle(Hs)))
                # referencia: 0° a 1 kHz
                ph -= ph[np.argmin(abs(f - 1000))]
                y = sample(f, ph, fp)
            else:
                ph = np.unwrap(np.angle(Hs))
                gd = -np.gradient(ph, 2 * np.pi * f) * 1e3
                y = sample(f, gd, fp)
            fl = "lineal" in name
            ax.plot(fp, y, color=COLS[name], label=name, lw=2.0 if "Original" in name else 1.8,
                    ls=(0, (6, 2)) if fl else "-", zorder=3 if fl else 2)
        logx(ax)
        ax.set_title(TIT[var], fontsize=10.5, color=INK)
    if kind == "mag":
        axs[0].set_ylim(-30, 6)
        axs[0].set_ylabel("Nivel (dB, 1/12 oct, 0 dB = banda media)")
        name, sup = "fig03_respuesta", "Respuesta en frecuencia en eje (atenuación previa compensada para comparar)"
    elif kind == "phase":
        axs[0].set_ylim(-420, 480)
        axs[0].set_ylabel("Fase (°, desenrollada, 0° a 1 kHz)")
        name, sup = "fig04_fase", "Fase (sin el retardo puro de la latencia)"
    else:
        axs[0].set_ylim(-2, 25)
        axs[0].set_ylabel("Retardo de grupo (ms, sin latencia)")
        name, sup = "fig05_retardo_grupo", "Retardo de grupo (sin el retardo puro de la latencia)"
    axs[1].legend(loc="lower right" if kind == "mag" else "upper right")
    fig.suptitle(f"{sup}\n{PROV}", fontsize=11, color=INK)
    fig.tight_layout()
    fig.savefig(os.path.join(G, name + ".png"), dpi=150)
    plt.close(fig)


def fig_time(info_all, kind):
    fs = 48000
    fig, axs = plt.subplots(1, 2, figsize=(13, 4.8), sharey=True)
    for ax, var in zip(axs, ["LIN50", "EXT40"]):
        info = info_all[f"{var}_48k"]
        f, S, lats = systems(var, info, fs)
        for name, Hs in S.items():
            h = np.fft.irfft(Hs, fd.N_BIG)
            # llevar la parte anticausal (pre-respuesta) a tiempos negativos
            h = np.roll(h, fd.N_BIG // 2)
            t = (np.arange(fd.N_BIG) - fd.N_BIG // 2) / fs * 1e3
            y = np.cumsum(h) if kind == "step" else h
            if kind == "imp":
                y = y / np.max(np.abs(y))
            fl = "lineal" in name
            ax.plot(t, y, color=COLS[name], label=name, lw=1.6, ls=(0, (5, 2)) if fl else "-", zorder=3 if fl else 2)
        if kind == "step":
            ax.set_xlim(-60, 120)
            ax.set_xlabel("Tiempo (ms) – 0 ms = llegada del sonido directo")
        else:
            ax.set_xlim(-1.5, 3.0)
            ax.set_xlabel("Tiempo (ms)")
        ax.set_title(TIT[var], fontsize=10.5, color=INK)
        ax.axhline(0, color=INK2, lw=0.8)
    if kind == "step":
        axs[0].set_ylabel("Respuesta al escalón (normalizada a la banda media)")
        name, sup = "fig06_escalon", "Respuesta al escalón · la de fase lineal tiene pre-respuesta (antes de 0 ms): es el precio de la fase plana también en el paso alto del grave"
    else:
        axs[0].set_ylabel("Respuesta al impulso (normalizada al pico)")
        name, sup = "fig07_impulso", "Respuesta al impulso (zoom en los primeros milisegundos)"
    axs[1].legend(loc="upper right")
    fig.suptitle(f"{sup}\n{PROV}", fontsize=11, color=INK)
    fig.tight_layout()
    fig.savefig(os.path.join(G, name + ".png"), dpi=150)
    plt.close(fig)


def load_map(esc):
    g = np.load(os.path.join(DATOS, f"mapa_nl_{esc}.npy"))
    meta = json.load(open(os.path.join(DATOS, "fase2_resultados.json")))
    return g, np.array(meta["F_GRID"]), np.array(meta["L_GRID"]), meta


def fig_thd_const():
    p = m.P
    fig, axs = plt.subplots(2, 3, figsize=(14, 8), sharex=True)
    for row, esc in enumerate(["conservador", "optimista"]):
        g, F, L, meta = load_map(esc)
        for col, (ci, lab) in enumerate([(4, "THD"), (2, "H2 (2.ª armónica)"), (3, "H3 (3.ª armónica)")]):
            ax = axs[row, col]
            for k, lev in enumerate([80, 85, 90, 95, 100]):
                li = int(np.argmin(abs(L - lev)))
                y = g[:, li, ci].copy()
                ok = (g[:, li, 0] <= p["V_lim"]) & (abs(g[:, li, 1] - lev) < 0.5)
                yo = np.where(ok, y, np.nan)
                yl = np.where(~ok, y, np.nan)
                # unir tramos
                ax.plot(F, yo, color=SEQ[k], label=f"{lev} dB")
                ax.plot(F, yl, color=SEQ[k], ls=":", lw=1.4)
            ax.axhline(1, color=INK2, lw=0.8, ls="--")
            ax.axhline(3, color=INK2, lw=0.8, ls="--")
            ax.set_yscale("log")
            ax.set_ylim(0.03, 60)
            ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v:g} %"))
            logx(ax, 20, 400)
            if row == 0:
                ax.set_xlabel("")
            ax.set_title(f"{lab} – escenario {esc}", fontsize=10.5, color=INK)
        axs[row, 0].set_ylabel("Distorsión (%)")
    axs[0, 0].legend(title="SPL a 1 m (una caja, 4π)", loc="upper right", fontsize=9)
    fig.suptitle("Distorsión del KH 120 A a SPL constante (simulación no lineal en el tiempo)\n"
                 "Punteado = el amplificador pide más tensión que el umbral estimado del limitador (28 V de pico) · líneas grises: 1 % y 3 %\n" + PROV,
                 fontsize=10.5, color=INK)
    fig.tight_layout()
    fig.savefig(os.path.join(G, "fig08_thd_spl_constante.png"), dpi=150)
    plt.close(fig)


def interp_map(g, F, L, f, spl, ci):
    """THD/x interpolado del mapa; por debajo de la rejilla escala con la amplitud."""
    out = np.full(len(f), np.nan)
    for i, (fi, si) in enumerate(zip(f, spl)):
        if fi < F[0] or fi > F[-1] or si > L[-1]:
            continue
        col = np.array([np.interp(np.log(fi), np.log(F), g[:, j, ci]) for j in range(len(L))])
        if si < L[0]:
            out[i] = col[0] * 10 ** ((si - L[0]) / 20)
        else:
            out[i] = np.interp(si, L, col)
    return out


def fig_thd_program(info_all):
    g, F, L, meta = load_map("conservador")
    fs = 48000
    f = fd.grid(fs)
    fp = np.geomspace(20, 300, 120)
    fig, axs = plt.subplots(2, 2, figsize=(13, 8), sharex=True)
    for col, lev in enumerate([85, 95]):
        for var, ls in [("LIN50", "-"), ("EXT40", (0, (6, 2)))]:
            info = info_all[f"{var}_48k"]
            _, S, _ = systems(var, info, fs)
            items = [("Original (KH 120 A de serie)", C_ORIG, "-")] if var == "LIN50" else []
            items += [("Corregido – fase lineal", C_FL if var == "LIN50" else C_BL, ls)]
            for name, c, lst in items:
                mag = np.abs(np.interp(fp, f, np.abs(S[name])))
                spl = lev + 20 * np.log10(np.maximum(mag, 1e-6))
                thd = interp_map(g, F, L, fp, spl, 4)
                thd[20 * np.log10(np.maximum(mag, 1e-6)) < -12] = np.nan   # fundamental despreciable: THD sin sentido
                x = interp_map(g, F, L, fp, spl, 5)
                lab = name if "Original" in name else f"Corregido {var}"
                axs[0, col].plot(fp, thd, color=c, ls=lst, label=lab)
                axs[1, col].plot(fp, x, color=c, ls=lst, label=lab)
        axs[0, col].set_yscale("log")
        axs[0, col].set_ylim(0.05, 60)
        axs[0, col].yaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v:g} %"))
        axs[0, col].axhline(1, color=INK2, lw=0.8, ls="--")
        axs[0, col].axhline(3, color=INK2, lw=0.8, ls="--")
        axs[0, col].set_title(f"THD con música a {lev} dB en banda media (1 m, una caja)\n(solo donde la respuesta está a menos de 12 dB por debajo de la banda media)", fontsize=10)
        axs[1, col].axhline(m.P["Xb"] * 1e3, color=INK2, lw=0.8, ls="--")
        axs[1, col].text(21, m.P["Xb"] * 1e3 + 0.15, "Xb estimado (Bl al 82 %)", color=INK2, fontsize=8.5)
        axs[1, col].set_title(f"Excursión del cono a {lev} dB en banda media", fontsize=10.5)
        for r in range(2):
            logx(axs[r, col], 20, 300)
        axs[0, col].set_xlabel("")
    axs[0, 0].set_ylabel("THD (%)")
    axs[1, 0].set_ylabel("Excursión de pico (mm)")
    axs[0, 0].legend(loc="upper right", fontsize=9)
    fig.suptitle("Coste en distorsión de cada versión con la MISMA señal (tono a tono, escenario conservador)\n"
                 "Por debajo de la sintonía el filtro corregido reduce excursión; EXT40 la aumenta entre 25 y 45 Hz\n" + PROV,
                 fontsize=10.5, color=INK)
    fig.tight_layout()
    fig.savefig(os.path.join(G, "fig09_thd_programa.png"), dpi=150)
    plt.close(fig)


def fig_limits():
    meta = json.load(open(os.path.join(DATOS, "fase2_resultados.json")))
    fig, ax = plt.subplots(figsize=(8, 5))
    levels = [80, 85, 90, 95, 100]
    for esc, ls, mk in [("conservador", "-", "o"), ("optimista", (0, (6, 2)), "s")]:
        for thr, c in [("1.0", C_FL), ("3.0", C_ORIG)]:
            y = [meta[esc]["limites"][str(l)][thr] for l in levels]
            y = [v if v is not None else np.nan for v in y]
            ax.plot(levels, y, color=c, ls=ls, marker=mk, ms=7, label=f"THD ≤ {float(thr):g} % · {esc}")
    ax.axhline(52, color=INK2, lw=0.8, ls=":")
    ax.text(80.2, 53.5, "−3 dB de serie (52 Hz)", color=INK2, fontsize=8.5)
    ax.set_yscale("log")
    ax.set_ylim(30, 200)
    ax.yaxis.set_major_formatter(FuncFormatter(hz_fmt))
    ax.set_yticks([30, 40, 50, 60, 80, 100, 150, 200])
    ax.set_xlabel("SPL a 1 m, una caja, campo libre (dB)")
    ax.set_ylabel("Frecuencia más baja reproducible (Hz)")
    ax.set_title("Hasta dónde puede bajar el KH 120 A sin pasar del umbral de THD\nni disparar el limitador (simulación)\n" + PROV, fontsize=10)
    ax.legend(fontsize=8.5, loc="upper left")
    fig.tight_layout()
    fig.savefig(os.path.join(G, "fig10_limites_extension.png"), dpi=150)
    plt.close(fig)


def fig_model():
    p = m.P
    f = np.geomspace(10, 24000, 2000)
    H = m.system_response(f, p, include_diffraction=False)
    Hd = m.system_response(f, p, include_diffraction=True)
    lp, hp = m.lr4(f, p["f_xo"])
    hb = m.bass_shape(f, p) * m.electronics_bass(f, p)
    hf = m.butter_mag_resp(f, p["f_hf"], 4, "low")
    fig, axs = plt.subplots(1, 2, figsize=(13, 4.8))
    ax = axs[0]
    ax.plot(f, 20 * np.log10(abs(hb * lp)), color=C_ORIG, lw=1.4, label="Woofer (con LR4 paso bajo)")
    ax.plot(f, 20 * np.log10(abs(hp * hf)), color=C_BL, lw=1.4, label="Tweeter (con LR4 paso alto)")
    ax.plot(f, 20 * np.log10(abs(H)), color=C_FL, lw=2.2, label="Suma (modelo usado en el FIR)")
    pts = [(46, -6), (52, -3), (54, -2), (21000, -3), (24000, -6)]
    ax.plot([a for a, _ in pts], [b for _, b in pts], "o", ms=8, color=INK, mfc="#fcfcfb", mew=1.6, label="Datos publicados por Neumann")
    logx(ax)
    ax.set_ylim(-30, 6)
    ax.set_ylabel("Nivel (dB)")
    ax.set_title("Modelo lineal calibrado (en eje, campo libre)", fontsize=10.5)
    ax.legend(fontsize=9, loc="lower center")
    ax = axs[1]
    dw = m.edge_diffraction(f, p, p["pos_w"])
    dt = m.edge_diffraction(f, p, p["pos_t"])
    ax.plot(f, 20 * np.log10(abs(dw)), color=C_ORIG, lw=1.6, label="Difracción, woofer (fuentes en los bordes)")
    ax.plot(f, 20 * np.log10(abs(dt)), color=C_BL, lw=1.6, label="Difracción, tweeter")
    ax.plot(f, 20 * np.log10(abs(Hd / H)), color=C_FL, lw=2.0, label="Residuo tras la compensación de baffle")
    logx(ax, 50, 24000)
    ax.set_ylim(-8, 4)
    ax.set_ylabel("dB")
    ax.set_title("Difracción del frontal de 182 × 277 mm (cantos redondeados de ~20 mm)", fontsize=10.5)
    ax.legend(fontsize=9, loc="lower right")
    fig.suptitle("Fase 2 – modelo del KH 120 A\n" + PROV, fontsize=11, color=INK)
    fig.tight_layout()
    fig.savefig(os.path.join(G, "fig01_modelo.png"), dpi=150)
    plt.close(fig)


def fig_trunc(info_all):
    fig, axs = plt.subplots(1, 2, figsize=(12, 4.3))
    for var, c in [("LIN50", C_FL), ("EXT40", C_ORIG)]:
        rows = info_all[f"{var}_48k"]["truncado"]
        N = [r["N"] for r in rows]
        axs[0].plot(N, [r["err_mag_dB"] for r in rows], color=c, marker="o", label=var)
        axs[1].plot(N, [r["err_fase_grados"] for r in rows], color=c, marker="o", label=var)
    for ax, lab, tol in [(axs[0], "Error máx. de magnitud (dB)", 0.1), (axs[1], "Error máx. de fase (°)", 2)]:
        ax.set_xscale("log", base=2)
        ax.set_yscale("log")
        ax.axhline(tol, color=INK2, ls="--", lw=0.8)
        ax.set_xlabel("Coeficientes del FIR de fase lineal (48 kHz) · latencia = N/2")
        ax.set_ylabel(lab)
        ax.xaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{int(v)}\n{v/2/48:.0f} ms"))
        ax.set_xticks([2048, 4096, 8192, 16384, 32768, 65536])
    axs[0].legend()
    fig.suptitle("Error por truncar el FIR (de 0,7·f_ext a 20 kHz) · línea discontinua = tolerancia usada\n" + PROV, fontsize=10.5)
    fig.tight_layout()
    fig.savefig(os.path.join(G, "fig11_error_truncado.png"), dpi=150)
    plt.close(fig)


if __name__ == "__main__":
    info = json.load(open(os.path.join(DATOS, "fase3_filtros.json")))
    fig_model()
    for k in ("mag", "phase", "gd"):
        fig_freq(info, k)
    fig_time(info, "step")
    fig_time(info, "imp")
    fig_thd_const()
    fig_thd_program(info)
    fig_limits()
    fig_trunc(info)
    print(sorted(os.listdir(G)))
