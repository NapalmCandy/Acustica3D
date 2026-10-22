"""
Fase 3: diseño de los FIR PROVISIONALES para el KH 120 A, a partir del modelo calibrado con datos publicados.

Variantes de grave:
  LIN50 : sin extensión. Objetivo Butterworth de 6.º orden a 50 Hz (≈ la caída natural, pero más
          empinado por debajo, que protege el cono por debajo de la sintonía del puerto).
  EXT40 : extensión a 40 Hz (-3 dB), solo para escuchar a nivel moderado (≤ 85 dB por caja a 1 m).
Versiones de fase:
  FL : fase lineal de todo el sistema (latencia = N/2 muestras).
  BL : baja latencia: magnitud en fase mínima + linealización del cruce de 2 kHz con ~2 ms de retardo.
"""
import json, os, sys
import numpy as np
from scipy import signal
from scipy.io import wavfile
sys.path.insert(0, os.path.dirname(__file__))
import kh120a_model as m

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILT = os.path.join(BASE, "filtros")
DATOS = os.path.join(BASE, "datos")

N_BIG = 2 ** 18
B_MAX_DB = 12.0          # realce máximo permitido
MARGEN_DB = 0.5          # margen sobre el realce máximo para la atenuación previa
VARIANTES = {"LIN50": 50.0, "EXT40": 40.0}


def grid(fs, n=N_BIG):
    return np.fft.rfftfreq(n, 1 / fs)


def system_H(f, p=m.P):
    """Respuesta del KH 120 A usada para el diseño (sin el rizado de difracción, que Neumann ya iguala)."""
    hb, ap, hfx = m.system_components(f, p)
    return hb * ap * hfx, hb, ap, hfx


def bw_hp(f, fc, order):
    return m.butter_mag_resp(np.maximum(f, 1e-3), fc, order, "high")


def target_mag(f, f_ext, p=m.P):
    _, _, _, hfx = system_H(f, p)
    return np.abs(bw_hp(f, f_ext, 6)) * np.abs(hfx)


def soft_limit_db(g_db, lim):
    """Limita suavemente el realce a 'lim' dB."""
    pos = g_db > 0
    out = g_db.copy()
    out[pos] = lim * np.tanh(g_db[pos] / lim)
    return out


def correction_mag(f, f_ext, p=m.P):
    H, *_ = system_H(f, p)
    T = target_mag(f, f_ext, p)
    g = T / np.maximum(np.abs(H), 1e-300)
    g[0] = g[1]          # sin ceros exactos: el cepstro necesita log finito en todos los bins
    g_db = 20 * np.log10(np.maximum(g, 1e-30))
    g_db = soft_limit_db(g_db, B_MAX_DB)
    return 10 ** (g_db / 20)


def ideal_linear(fs, f_ext, p=m.P):
    """Corrección ideal de fase lineal sobre la rejilla N_BIG, centrada en N_BIG/2."""
    f = grid(fs)
    H, *_ = system_H(f, p)
    g = correction_mag(f, f_ext, p)
    phase_H = np.angle(H)
    C = g * np.exp(-1j * phase_H)               # cancela la fase del sistema
    C *= np.exp(-1j * 2 * np.pi * f * (N_BIG // 2) / fs)
    h = np.fft.irfft(C, N_BIG)
    return h, C


def truncate_centered(h_big, n):
    """Recorta n muestras centradas en N_BIG/2 con flancos Hann del 10 % a cada lado."""
    c = N_BIG // 2
    seg = h_big[c - n // 2: c + n // 2].copy()
    w = np.ones(n)
    k = max(int(0.1 * n), 2)
    ramp = 0.5 - 0.5 * np.cos(np.pi * np.arange(k) / k)
    w[:k] = ramp
    w[-k:] = ramp[::-1]
    return seg * w


def minphase_from_mag(mag, n):
    """Fase mínima por cepstro real (mag en los bins de rfft de tamaño n)."""
    logm = np.log(np.maximum(mag, 1e-300))
    cep = np.fft.irfft(logm, n)
    fold = np.zeros(n)
    fold[0] = cep[0]
    fold[1:n // 2] = 2 * cep[1:n // 2]
    fold[n // 2] = cep[n // 2]
    return np.exp(np.fft.rfft(fold, n))


def low_latency(fs, f_ext, d_ms, n_out, p=m.P):
    f = grid(fs)
    H, hb, ap, hfx = system_H(f, p)
    g = correction_mag(f, f_ext, p)
    Cmp = minphase_from_mag(g, N_BIG)
    # inversa del pasatodo del cruce, retrasada d y recortada (solo afecta a ~200 Hz-20 kHz)
    d = int(round(d_ms * 1e-3 * fs))
    ex = ap * hfx / np.maximum(np.abs(hfx), 1e-30)   # fase "en exceso": pasatodo del cruce + caída ultrasónica
    A = np.conj(ex) * np.exp(-1j * 2 * np.pi * f * d / fs)
    a = np.fft.irfft(A, N_BIG)
    w = np.zeros(N_BIG)
    k = max(d // 4, 4)
    w[:2 * d] = 1.0
    w[:k] = 0.5 - 0.5 * np.cos(np.pi * np.arange(k) / k)
    w[2 * d - k:2 * d] = (0.5 - 0.5 * np.cos(np.pi * np.arange(k) / k))[::-1]
    a *= w
    h = np.fft.irfft(Cmp * np.fft.rfft(a), N_BIG)[:n_out].copy()
    kk = int(0.1 * n_out)
    h[-kk:] *= (0.5 + 0.5 * np.cos(np.pi * np.arange(kk) / kk))
    return h, d


def resp(h, fs, n=N_BIG):
    return np.fft.rfft(h, n)


def trunc_error(fs, f_ext, h_big, C_ideal, Ns):
    """Error de magnitud (dB) y fase (°) al truncar el FIR de fase lineal a N coeficientes."""
    f = grid(fs)
    band = (f >= 0.7 * f_ext) & (f <= 20000)
    band20 = (f >= 20) & (f <= 20000)
    rows = []
    for n in Ns:
        ht = truncate_centered(h_big, n)
        # mismo retardo que la ideal: colocar en N_BIG/2 - n/2
        Ht = resp(ht, fs) * np.exp(-1j * 2 * np.pi * f * (N_BIG // 2 - n // 2) / fs)
        with np.errstate(divide="ignore", invalid="ignore"):
            r = Ht / C_ideal
        emag = np.abs(20 * np.log10(np.abs(r[band])))
        eph = np.abs(np.degrees(np.angle(r[band])))
        emag20 = np.abs(20 * np.log10(np.maximum(np.abs(r[band20]), 1e-6)))
        # error relativo de la energía fuera de la ventana
        c = N_BIG // 2
        e_out = 1 - np.sum(h_big[c - n // 2:c + n // 2] ** 2) / np.sum(h_big ** 2)
        rows.append(dict(N=int(n), latencia_ms=1e3 * (n // 2) / fs, err_mag_dB=float(emag.max()),
                         err_fase_grados=float(eph.max()), err_mag_dB_desde20Hz=float(emag20.max()),
                         energia_fuera_pct=100 * float(e_out)))
    return rows


def pick_N(rows, mag_tol=0.1, ph_tol=2.0):
    for r in rows:
        if r["err_mag_dB"] <= mag_tol and r["err_fase_grados"] <= ph_tol:
            return r["N"]
    return rows[-1]["N"]


def write_wav(path, h, fs):
    st = np.stack([h, h], axis=1).astype(np.float32)
    wavfile.write(path, fs, st)


def worst_square_peak_db(h, fs, f_lo=25.0, f_hi=150.0, n_f=40):
    """Pico de salida (dBFS) con ondas cuadradas a 0 dBFS (bombos recortados): peor caso entre f_lo y f_hi."""
    from scipy.signal import fftconvolve
    t = np.arange(int(1.0 * fs)) / fs
    worst = (-99.0, 0.0)
    for f0 in np.geomspace(f_lo, f_hi, n_f):
        sq = np.sign(np.sin(2 * np.pi * f0 * t))
        y = fftconvolve(sq, h)[len(h):len(t)]
        pk = 20 * np.log10(np.abs(y).max())
        if pk > worst[0]:
            worst = (pk, f0)
    return worst


def common_headroom(resumen, margin_db=0.5):
    """Atenuación común para todos los filtros: ninguna cuadrada a 0 dBFS de 25-150 Hz sale por encima
    de -margin dBFS, y todos los filtros suenan al mismo nivel (sin saltos al cambiar)."""
    need = []
    for key, r in resumen.items():
        for name in r["ficheros"]:
            fs, h = wavfile.read(os.path.join(FILT, name))
            pk, f0 = worst_square_peak_db(h[:, 0].astype(float), fs)
            r.setdefault("peor_cuadrada", {})[name] = dict(pico_dBFS=float(pk), f0_Hz=float(f0))
            need.append(r["atenuacion_previa_dB"] + pk + margin_db)
    total = float(np.ceil(max(need) * 2) / 2)      # redondeo a 0,5 dB
    for key, r in resumen.items():
        extra = total - r["atenuacion_previa_dB"]
        for name in r["ficheros"]:
            fs, h = wavfile.read(os.path.join(FILT, name))
            write_wav(os.path.join(FILT, name), h[:, 0].astype(float) * 10 ** (-extra / 20), fs)
        r["atenuacion_total_dB"] = total
    return total


def design_all():
    os.makedirs(FILT, exist_ok=True)
    resumen = {}
    Ns = [2048, 4096, 8192, 16384, 32768, 65536]
    for fs in (44100, 48000):
        for var, f_ext in VARIANTES.items():
            h_big, C = ideal_linear(fs, f_ext)
            rows = trunc_error(fs, f_ext, h_big, C, Ns)
            n_fl = pick_N(rows)
            h_fl = truncate_centered(h_big, n_fl)
            # baja latencia: retardo del cruce elegido por error de fase <= 10° (500 Hz-20 kHz)
            f = grid(fs)
            H, hb, ap, hfx = system_H(f)
            best = None
            ref = bw_hp(f, f_ext, 6) * np.abs(hfx)
            for d_ms in (0.5, 1.0, 1.5, 2.0, 3.0, 4.0):
                h_bl, d = low_latency(fs, f_ext, d_ms, 16384)
                tot = resp(h_bl, fs) * H * np.exp(1j * 2 * np.pi * f * d / fs)
                band = (f >= 100) & (f <= 20000)
                r = tot[band] / ref[band]
                ph_err = np.degrees(np.abs(np.angle(r)))
                mag_err = np.abs(20 * np.log10(np.abs(r) / np.median(np.abs(r))))
                cand = (d_ms, h_bl, d, float(ph_err.max()), float(mag_err.max()))
                best = cand
                if ph_err.max() <= 5 and mag_err.max() <= 0.1:
                    break
            d_ms, h_bl, d, ph_bl, mag_bl = best
            # atenuación previa común para FL y BL
            g = correction_mag(f, f_ext)
            gmax_db = 20 * np.log10(g.max())
            g_real = max(np.abs(resp(h_fl, fs)).max(), np.abs(resp(h_bl, fs)).max())
            att_db = 20 * np.log10(g_real) + MARGEN_DB
            att = 10 ** (-att_db / 20)
            h_fl_a, h_bl_a = h_fl * att, h_bl * att
            # comprobación real de la ganancia de los FIR ya atenuados
            gfl = 20 * np.log10(np.abs(resp(h_fl_a, fs)).max())
            gbl = 20 * np.log10(np.abs(resp(h_bl_a, fs)).max())
            khz = "44k1" if fs == 44100 else "48k"
            n_fl_name = f"KH120A_PROVISIONAL_{var}_faselineal_{khz}.wav"
            n_bl_name = f"KH120A_PROVISIONAL_{var}_bajalatencia_{khz}.wav"
            write_wav(os.path.join(FILT, n_fl_name), h_fl_a, fs)
            write_wav(os.path.join(FILT, n_bl_name), h_bl_a, fs)
            resumen[f"{var}_{khz}"] = dict(
                fs=fs, f_ext=f_ext, realce_max_dB=float(gmax_db), atenuacion_previa_dB=float(att_db),
                ganancia_max_FL_dB=float(gfl), ganancia_max_BL_dB=float(gbl),
                suma_abs_FL_dB=float(20 * np.log10(np.sum(np.abs(h_fl_a)))),
                suma_abs_BL_dB=float(20 * np.log10(np.sum(np.abs(h_bl_a)))),
                N_FL=int(n_fl), latencia_FL_ms=1e3 * (n_fl // 2) / fs,
                N_BL=int(len(h_bl)), latencia_BL_ms=1e3 * d / fs, error_fase_BL_cruce_grados=ph_bl, error_mag_BL_dB=mag_bl,
                truncado=rows, ficheros=[n_fl_name, n_bl_name])
            print(var, khz, "N_FL", n_fl, "lat %.1f ms" % (1e3 * (n_fl // 2) / fs), "| BL d=%.1f ms err %.1f° %.2f dB" % (1e3 * d / fs, ph_bl, mag_bl),
                  "| realce %.1f dB, atenuación %.1f dB, |C|max FL %.2f BL %.2f dB" % (gmax_db, att_db, gfl, gbl))
    total = common_headroom(resumen)
    print("Atenuación común (nivel en banda media de todos los WAV): -%.1f dB" % total)
    with open(os.path.join(DATOS, "fase3_filtros.json"), "w") as fh:
        json.dump(resumen, fh, indent=1)
    return resumen


if __name__ == "__main__":
    design_all()
