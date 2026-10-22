"""
Modelo del Neumann KH 120 A (analógico).

Todo lo marcado [E] es ESTIMADO (Neumann no publica los T/S ni el Xmax) y se ha
calibrado contra los datos publicados:
  - campo libre: -2 dB a 54 Hz, -3 dB a 52 Hz, -6 dB a 46 Hz; -3 dB a 21 kHz, -6 dB a 24 kHz
  - SPL máx. con 3 % de THD, media de 50-100 Hz: 104,8 dB en semiespacio (= 98,8 dB en 4π)
  - THD < 0,5 % a 95 dB semiespacio (= 89 dB en 4π) por encima de 120 Hz
  - caja de 6,5 L internos, puertos frontales, filtro LR4 a 2 kHz, infrasónico de 30 Hz y 6 dB/oct

Convenio de SPL: una caja, en eje, a 1 m, campo libre (4π) salvo que se diga otra cosa.
"""
import numpy as np
from numba import njit
from scipy import signal

RHO = 1.20
C0 = 343.0
RHOC2 = RHO * C0 ** 2

# ---------------------------------------------------------------- parámetros
P = dict(
    # woofer [E]
    Re=5.6, Le=0.35e-3, Bl=6.2, Mms=11.5e-3, Sd=88e-4, fs=38.0, Qms=3.5,
    # caja / puerto
    Vb=6.5e-3,           # [N/D] volumen interno
    Fb=45.0,             # [E] sintonía (calibrada: -3 dB a 52 Hz, -6 dB a 46 Hz)
    Sp=14e-4,            # [E] área total de los dos puertos (2 ranuras frontales)
    QL=10.0,             # [E] pérdidas por fugas
    Qp=60.0,             # [E] pérdidas lineales del puerto
    xi_port=0.5,         # [E] coef. de pérdida no lineal del puerto (bocas abocinadas)
    # no linealidades del woofer [E]
    Xb=6.0e-3,           # desplazamiento con Bl al 82 % (calibrado: THD < 0,5 % a 89 dB/4π por encima de 120 Hz)
    x0=0.25e-3,          # descentrado de la bobina (genera H2)
    k1=0.10, k2=0.60,    # Kms(x) = K0 (1 + k1 x/Xb + k2 (x/Xb)^2)
    l1=0.08, l2=0.02,    # Le(x)  = Le0 (1 - l1 x/Xb + l2 (x/Xb)^2)
    # electrónica
    f_infra=30.0,        # [D] infrasónico de 1.er orden
    eq_f=55.0, eq_g=2.2, eq_Q=1.8,  # [E] realce electrónico de grave (necesario para la pendiente publicada)
    f_xo=2000.0,         # [D] LR4
    f_hf=21000.0,        # [E] caída de 4.º orden del tweeter (-3 dB a 21k, -6 dB a 24k)
    V_lim=28.0,          # [E] umbral del limitador de pico, V de pico (≈ 50 W en 8 Ω)
    V_clip=35.8,         # [E] recorte del amplificador, V de pico (≈ 80 W en 8 Ω)
    # baffle
    W=0.182, H=0.277,
    pos_w=(0.091, 0.090), pos_t=(0.091, 0.205),  # [E] centro de woofer y tweeter
    r_edge=0.020,        # [E] radio de redondeo de los cantos
)


# Escenario optimista: más cerca de los 104,8 dB de grave que declara Neumann
OPTIMISTA = dict(Xb=9.0e-3, xi_port=0.2)


def derived(p):
    d = {}
    ws = 2 * np.pi * p["fs"]
    d["Kms"] = ws ** 2 * p["Mms"]
    d["Rms"] = ws * p["Mms"] / p["Qms"]
    d["Vas"] = RHOC2 * p["Sd"] ** 2 / d["Kms"]
    d["Qes"] = ws * p["Mms"] * p["Re"] / p["Bl"] ** 2
    d["Qts"] = d["Qes"] * p["Qms"] / (d["Qes"] + p["Qms"])
    d["Cab"] = p["Vb"] / RHOC2
    wb = 2 * np.pi * p["Fb"]
    d["Map"] = 1.0 / (wb ** 2 * d["Cab"])
    d["Ral"] = p["QL"] / (wb * d["Cab"])
    d["Rap"] = wb * d["Map"] / p["Qp"]
    d["Kp"] = 0.5 * RHO * p["xi_port"] / p["Sp"] ** 2
    d["Lport_eff"] = d["Map"] * p["Sp"] / RHO
    return d


# ---------------------------------------------------------------- modelo lineal
def ts_linear(f, p, with_le=True):
    """Volumen-velocidad total radiada por V=1 (pico), solución lineal exacta del circuito.
    Devuelve U (m^3/s por voltio) e x (m por voltio)."""
    d = derived(p)
    w = 2 * np.pi * np.asarray(f, float)
    s = 1j * w
    U = np.zeros_like(s)
    X = np.zeros_like(s)
    Le = p["Le"] if with_le else 0.0
    for n, sn in enumerate(s):
        # incógnitas: I, v, Pb, Up
        A = np.array([
            [p["Re"] + sn * Le, p["Bl"], 0, 0],
            [-p["Bl"], sn * p["Mms"] + d["Rms"] + d["Kms"] / sn, -p["Sd"], 0],
            [0, p["Sd"], sn * d["Cab"] + 1 / d["Ral"], 1],
            [0, 0, -1, sn * d["Map"] + d["Rap"]],
        ], dtype=complex)
        b = np.array([1, 0, 0, 0], dtype=complex)
        I, v, Pb, Up = np.linalg.solve(A, b)
        U[n] = p["Sd"] * v + Up + Pb / d["Ral"]
        X[n] = v / sn
    return U, X


def p_2pi_per_volt(f, p, with_le=True):
    U, X = ts_linear(f, p, with_le)
    return 1j * 2 * np.pi * np.asarray(f) * RHO * U / (2 * np.pi * 1.0), X


def bass_shape(f, p):
    """Forma del paso alto acústico (reflex + mecánica), normalizada a 1 en la banda de paso."""
    pf, _ = p_2pi_per_volt(f, p, with_le=False)
    ref = RHO * p["Bl"] * p["Sd"] / (2 * np.pi * p["Mms"] * p["Re"])
    return pf / ref


def hp1(f, fc):
    s = 1j * np.asarray(f) / fc
    return s / (1 + s)


def lr4(f, fc):
    s = 1j * np.asarray(f) / fc
    bw2_lp = 1 / (s ** 2 + np.sqrt(2) * s + 1)
    bw2_hp = s ** 2 / (s ** 2 + np.sqrt(2) * s + 1)
    return bw2_lp ** 2, bw2_hp ** 2


def peq(f, f0, g, Q):
    A = 10 ** (g / 40)
    s = 1j * np.asarray(f) / f0
    return (s ** 2 + s * A / Q + 1) / (s ** 2 + s / (A * Q) + 1)


def electronics_bass(f, p):
    return hp1(f, p["f_infra"]) * peq(f, p["eq_f"], p["eq_g"], p["eq_Q"])


def butter_mag_resp(f, fc, order, kind):
    """Respuesta compleja analógica Butterworth (fase mínima)."""
    b, a = signal.butter(order, 2 * np.pi * fc, btype=kind, analog=True)
    _, h = signal.freqs(b, a, worN=2 * np.pi * np.asarray(f))
    return h


# ---------------------------------------------------------------- difracción
def edge_diffraction(f, p, src, n_edge=720):
    """Fuentes en los bordes (modelo de Urban / Vanderkooy simplificado).
    D -> 0,5 en baja frecuencia (4π) y -> 1 en alta (2π). Cantos redondeados = paso bajo."""
    W, H = p["W"], p["H"]
    # perímetro
    per = 2 * (W + H)
    t = (np.arange(n_edge) + 0.5) / n_edge * per
    pts = np.zeros((n_edge, 2))
    for i, ti in enumerate(t):
        if ti < W:
            pts[i] = (ti, 0)
        elif ti < W + H:
            pts[i] = (W, ti - W)
        elif ti < 2 * W + H:
            pts[i] = (W - (ti - W - H), H)
        else:
            pts[i] = (0, H - (ti - 2 * W - H))
    rel = pts - np.array(src)
    dist = np.hypot(rel[:, 0], rel[:, 1])
    ang = np.unwrap(np.arctan2(rel[:, 1], rel[:, 0]))
    dang = np.abs(np.gradient(ang))
    wgt = dang / dang.sum()
    k = 2 * np.pi * np.asarray(f)[:, None] / C0
    rnd = 1 / (1 + 1j * np.asarray(f)[:, None] / (C0 / (2 * np.pi * p["r_edge"])))
    D = 1 - 0.5 * np.sum(wgt[None, :] * np.exp(-1j * k * dist[None, :]) * rnd, axis=1)
    return D


def bsc_shelf(f, p):
    """Compensación del escalón de baffle de la electrónica: +6 dB en grave, 0 dB en agudo [E]."""
    fb = 160.0   # ajustado por mínimos cuadrados al D(f) del modelo de bordes (el clásico 115/W da 632 Hz y sobrecompensa)
    s = 1j * np.asarray(f) / fb
    return (2 + s) / (1 + s)


# ---------------------------------------------------------------- sistema completo
def system_response(f, p, include_diffraction=True):
    """Respuesta en eje a 1 m del KH 120 A (fase mínima salvo el pasatodo del cruce).
    Normalizada a 0 dB en la banda media."""
    f = np.asarray(f, float)
    fpos = np.maximum(f, 1e-3)
    hb = bass_shape(fpos, p) * electronics_bass(fpos, p)
    lp, hp = lr4(fpos, p["f_xo"])
    hf = butter_mag_resp(fpos, p["f_hf"], 4, "low")
    if include_diffraction:
        bsc = bsc_shelf(fpos, p)
        res_w = edge_diffraction(fpos, p, p["pos_w"]) * bsc
        # la guía de ondas del tweeter reduce el residuo de difracción a la mitad [E]
        res_t = 1 + 0.5 * (edge_diffraction(fpos, p, p["pos_t"]) * bsc - 1)
        h = hb * (lp * res_w + hp * hf * res_t)
    else:
        h = hb * (lp + hp * hf)
    return h


def system_components(f, p):
    """Partes separadas (para el FIR provisional): grave de fase mínima, pasatodo del cruce y caída HF."""
    f = np.maximum(np.asarray(f, float), 1e-3)
    hb = bass_shape(f, p) * electronics_bass(f, p)
    lp, hp = lr4(f, p["f_xo"])
    ap = lp + hp  # LR4: suma = pasatodo de 2.º orden
    hf = butter_mag_resp(f, p["f_hf"], 4, "low")
    # el tweeter cae arriba y el woofer no; arriba de 5 kHz manda el tweeter
    hfx = (lp + hp * hf) / ap
    return hb, ap, hfx


# ---------------------------------------------------------------- simulación no lineal
@njit(cache=True)
def _deriv(st, V, pr):
    i, x, v, Pb, Up = st[0], st[1], st[2], st[3], st[4]
    Re, Le0, Bl0, Mms, Sd, K0, Rms, Cab, Map, Ral, Rap, Kp, Xb, x0, k1, k2, l1, l2 = (
        pr[0], pr[1], pr[2], pr[3], pr[4], pr[5], pr[6], pr[7], pr[8], pr[9],
        pr[10], pr[11], pr[12], pr[13], pr[14], pr[15], pr[16], pr[17])
    u = x / Xb
    ub = (x - x0) / Xb
    Bl = Bl0 * np.exp(-0.19845 * ub * ub)          # ln(1/0.82) = 0.19845
    L = Le0 * (1.0 - l1 * u + l2 * u * u)
    if L < 0.2 * Le0:
        L = 0.2 * Le0
    dLdx = Le0 * (-l1 + 2.0 * l2 * u) / Xb
    Fk = K0 * (1.0 + k1 * u + k2 * u * u) * x
    di = (V - Re * i - Bl * v - dLdx * v * i) / L
    dv = (Bl * i - Rms * v - Fk + Sd * Pb + 0.5 * dLdx * i * i) / Mms
    dPb = -(Sd * v + Up + Pb / Ral) / Cab
    dUp = (Pb - Rap * Up - Kp * abs(Up) * Up) / Map
    out = np.empty(5)
    out[0] = di
    out[1] = v
    out[2] = dv
    out[3] = dPb
    out[4] = dUp
    return out


@njit(cache=True)
def _clip(v, Vc):
    """Recorte del amplificador: lineal hasta el 90 % de Vc, rodilla suave hasta Vc."""
    k = 0.9 * Vc
    a = abs(v)
    if a <= k:
        return v
    y = k + (Vc - k) * np.tanh((a - k) / (Vc - k))
    return y if v > 0 else -y


@njit(cache=True)
def simulate(pr, f, Vpk, fs, n_settle, n_anal, Vclip):
    n = n_settle + n_anal
    h = 1.0 / fs
    st = np.zeros(5)
    p_out = np.empty(n_anal)
    x_out = np.empty(n_anal)
    up_out = np.empty(n_anal)
    Ral = pr[9]
    Sd = pr[4]
    w = 2 * np.pi * f
    n_ramp = n_settle // 2
    for k in range(n):
        t = k * h
        env = 1.0
        if k < n_ramp:
            env = 0.5 - 0.5 * np.cos(np.pi * k / n_ramp)
        # entrada con recorte suave del amplificador
        Vs = np.empty(3)
        for m in range(3):
            tm = t + 0.5 * h * m
            vv = env * Vpk * np.sin(w * tm)
            Vs[m] = _clip(vv, Vclip)
        k1_ = _deriv(st, Vs[0], pr)
        k2_ = _deriv(st + 0.5 * h * k1_, Vs[1], pr)
        k3_ = _deriv(st + 0.5 * h * k2_, Vs[1], pr)
        k4_ = _deriv(st + h * k3_, Vs[2], pr)
        st = st + h / 6.0 * (k1_ + 2 * k2_ + 2 * k3_ + k4_)
        if k >= n_settle:
            dd = _deriv(st, Vs[2], pr)
            dU = Sd * dd[2] + dd[4] + dd[3] / Ral
            p_out[k - n_settle] = 1.2 * dU / (4 * np.pi)   # 4π, 1 m
            x_out[k - n_settle] = st[1]
            up_out[k - n_settle] = st[4]
    return p_out, x_out, up_out


def pack(p):
    d = derived(p)
    return np.array([p["Re"], p["Le"], p["Bl"], p["Mms"], p["Sd"], d["Kms"], d["Rms"], d["Cab"],
                     d["Map"], d["Ral"], d["Rap"], d["Kp"], p["Xb"], p["x0"], p["k1"], p["k2"],
                     p["l1"], p["l2"]], dtype=np.float64)


def harmonics(y, f, fs, nh=7):
    n = len(y)
    t = np.arange(n) / fs
    win = np.hanning(n)
    amps = np.zeros(nh + 1)
    for k in range(1, nh + 1):
        amps[k] = 2 * abs(np.sum(win * y * np.exp(-2j * np.pi * k * f * t))) / win.sum()
    return amps


def tone(p, f, Vpk, fs=48000, pr=None, Dcorr=None):
    """Simula un tono y devuelve SPL (dB, 4π 1 m), H2, H3 y THD (%), x pico (mm) y velocidad del puerto (m/s)."""
    if pr is None:
        pr = pack(p)
    per = fs / f
    n_settle = int(max(0.30 * fs, 14 * per))
    n_anal = int(round(16 * per))
    pt, xt, up = simulate(pr, f, Vpk, fs, n_settle, n_anal, p["V_clip"])
    a = harmonics(pt, f, fs)
    if Dcorr is not None:  # difracción: cada armónico radia con su D(k f) (simulación hecha en 4π)
        a = a * Dcorr(np.arange(len(a)) * f + 1e-9)
    spl = 20 * np.log10(a[1] / np.sqrt(2) / 2e-5)
    h2 = 100 * a[2] / a[1]
    h3 = 100 * a[3] / a[1]
    thd = 100 * np.sqrt(np.sum(a[2:] ** 2)) / a[1]
    xpk = 1e3 * max(abs(xt.max()), abs(xt.min()))
    vport = np.max(np.abs(up)) / p["Sp"]
    return spl, h2, h3, thd, xpk, vport


def make_dcorr(p):
    def D(fr):
        fr = np.atleast_1d(fr)
        return np.abs(edge_diffraction(fr, p, p["pos_w"])) / 0.5
    return D
