"""Pruebas del KH120A Corrector compilado, cargado en un host VST3 real (pedalboard)."""
import sys, time, json
import numpy as np
from scipy.signal import fftconvolve
from scipy.io import wavfile
import pedalboard

PLUG = sys.argv[1] if len(sys.argv) > 1 else "plugin/bin/KH120ACorrector.vst3"
ok_all = True


def check(name, cond, info=""):
    global ok_all
    ok_all &= bool(cond)
    print(("OK   " if cond else "FALLO"), name, info)


def run(pl, x, fs):
    # pasada de calentamiento: aplica parámetros y frecuencia y deja que el plugin notifique su latencia;
    # después pedalboard compensa la latencia reportada y la salida queda alineada con la entrada
    pl.process(np.zeros((2, 4096), np.float32), fs, reset=True)
    return pl.process(x.astype(np.float32), fs, reset=True)


rng = np.random.default_rng(0)
for fs in (44100, 48000, 88200, 96000):
    khz = {44100: "44k1", 48000: "48k", 88200: "88k2", 96000: "96k"}[fs]
    x = (rng.standard_normal((2, int(fs * 2.0))) * 0.1).astype(np.float32)
    for var in ("LIN50", "EXT40"):
        for fase, fname in ((0.0, "faselineal"), (1.0, "bajalatencia")):
            pl = pedalboard.load_plugin(PLUG)
            pl.filtro = pl.parameters["filtro"].valid_values[0 if var == "LIN50" else 1]
            pl.fase = pl.parameters["fase"].valid_values[int(fase)]
            y = run(pl, x, fs)
            lat = pl.reported_latency_samples
            if khz:
                _, h = wavfile.read(f"filtros/KH120A_PROVISIONAL_{var}_{fname}_{khz}.wav")
                h = h[:, 0].astype(np.float64)
                fir_lat = len(h) // 2 if fname == "faselineal" else int(round(1e-3 * fs))
                ref = fftconvolve(x[0].astype(np.float64), h)[fir_lat:fir_lat + x.shape[1]]
                s0 = int(0.5 * fs)                      # tras el arranque suave y el cambio de filtro
                err = y[0, s0:] - ref[s0:]
                rel = 20 * np.log10(np.sqrt(np.mean(err ** 2)) / np.sqrt(np.mean(ref[s0:] ** 2)))
                check(f"{fs} {var} {fname}: igual a la convolución de referencia", rel < -80, f"error {rel:.1f} dB · latencia {lat} muestras = {1e3*lat/fs:.1f} ms")
            else:
                g = np.sqrt(np.mean(y[0, lat + int(0.05*fs):] ** 2)) / np.sqrt(np.mean(x[0] ** 2))
                check(f"{fs} {var} {fname}: procesa (sin WAV de referencia a 96k)", 0.05 < g < 0.5, f"ganancia rms {20*np.log10(g):.1f} dB · latencia {1e3*lat/fs:.1f} ms")

fs = 48000
t = np.arange(int(fs * 1.5)) / fs
# bypass seguro: -12 dB exactos, sin cambio de latencia
pl = pedalboard.load_plugin(PLUG)
lat_on = None
pl.bypass_seguro_12_db = True
x = (rng.standard_normal((2, len(t))) * 0.1).astype(np.float32)
y = run(pl, x, fs)
s0 = pl.reported_latency_samples + int(0.05 * fs)
err = y[:, s0:] - x[:, s0:] * 10 ** (-12 / 20)
check("bypass seguro = entrada × -12 dB, alineada", np.max(np.abs(err)) < 1e-5, f"error máx {np.max(np.abs(err)):.2e}")

# limitador: seno de 1 kHz a +18 dBFS con bypass (salida esperada +6 dBFS) -> limitado a -0,5 dBFS
pl = pedalboard.load_plugin(PLUG)
pl.bypass_seguro_12_db = True
x = np.tile(8.0 * np.sin(2 * np.pi * 1000 * t), (2, 1)).astype(np.float32)
y = run(pl, x, fs)
pk = 20 * np.log10(np.max(np.abs(y)))
check("limitador: +6 dBFS de salida queda <= -0,5 dBFS", pk <= -0.45, f"pico {pk:.2f} dBFS")
pl.limitador_de_seguridad = False
y = run(pl, x, fs)
check("sin limitador: tope duro de seguridad en 0,999", np.max(np.abs(y)) <= 0.9991, f"pico {np.max(np.abs(y)):.4f}")

# NaN/Inf en la entrada no deben propagarse
pl = pedalboard.load_plugin(PLUG)
x = (rng.standard_normal((2, len(t))) * 0.1).astype(np.float32)
x[:, 5000:5010] = np.nan
x[:, 9000] = np.inf
y = run(pl, x, fs)
check("NaN/Inf en la entrada: salida finita", np.all(np.isfinite(y)))

# frecuencia no soportada -> -12 dB sin corrección, estado = 1
pl = pedalboard.load_plugin(PLUG)
x = (rng.standard_normal((2, 32000)) * 0.1).astype(np.float32)
y = run(pl, x, 32000)
s0 = pl.reported_latency_samples + 2000
g = np.sqrt(np.mean(y[0, s0:] ** 2)) / np.sqrt(np.mean(x[0, s0:] ** 2))
check("32 kHz (no soportada): paso a -12 dB", abs(20 * np.log10(g) + 12) < 0.1, f"{20*np.log10(g):.2f} dB")

# CPU: 60 s estéreo a 48 kHz en bloques de 256 (como un host)
for fase_i, nombre in ((0, "fase lineal"), (1, "baja latencia")):
    pl = pedalboard.load_plugin(PLUG)
    pl.fase = pl.parameters["fase"].valid_values[fase_i]
    x = (rng.standard_normal((2, 48000 * 60)) * 0.1).astype(np.float32)
    t0 = time.perf_counter()
    for i in range(0, x.shape[1], 256):
        pl.process(x[:, i:i + 256], 48000, buffer_size=256, reset=False)
    dt = time.perf_counter() - t0
    check(f"CPU {nombre}: 60 s de audio en {dt:.2f} s", dt < 6, f"≈ {100*dt/60:.1f} % de un núcleo (incluye la sobrecarga de Python)")



# --- cambios en caliente (con audio sonando): sin picos ni saltos bruscos ---
def hot_switch_test():
    fs = 48000
    pl = pedalboard.load_plugin(PLUG)
    t = np.arange(fs * 8) / fs
    x = np.tile(0.5 * np.sin(2 * np.pi * 110 * t), (2, 1)).astype(np.float32)
    acts = {int(1.0 * fs): ("filtro", 1), int(2.0 * fs): ("fase", 1), int(3.0 * fs): ("bypass", True),
            int(4.0 * fs): ("bypass", False), int(5.0 * fs): ("fase", 0), int(6.0 * fs): ("filtro", 0)}
    out = []
    bs = 512
    pl.process(np.zeros((2, 4096), np.float32), fs, reset=True)
    for i in range(0, x.shape[1], bs):
        for k, (what, v) in acts.items():
            if i <= k < i + bs:
                if what == "filtro": pl.filtro = pl.parameters["filtro"].valid_values[v]
                elif what == "fase": pl.fase = pl.parameters["fase"].valid_values[v]
                else: pl.bypass_seguro_12_db = v
        out.append(pl.process(x[:, i:i + bs], fs, buffer_size=bs, reset=False))
    y = np.concatenate(out, axis=1)[0]
    # nivel estable de cada tramo (entre cambios, cuando ya se ha asentado)
    steady = max(np.max(np.abs(y[int((s + 0.5) * fs):int((s + 0.95) * fs)])) for s in range(7))
    d_steady = np.max(np.abs(np.diff(y[int(0.5 * fs):int(0.95 * fs)])))
    check("cambios en caliente: el pico nunca supera el nivel estable más alto en más de 0,5 dB",
          np.max(np.abs(y)) <= steady * 10 ** (0.5 / 20), f"pico {20*np.log10(np.max(np.abs(y))):.2f} dBFS, estable {20*np.log10(steady):.2f} dBFS")
    check("cambios en caliente: sin escalones (chasquidos)", np.max(np.abs(np.diff(y))) <= d_steady * 1.1,
          f"salto máx {np.max(np.abs(np.diff(y))):.4f} frente a {d_steady:.4f} en régimen")
    check("cambios en caliente: salida finita", np.all(np.isfinite(y)))


hot_switch_test()
print("\nRESULTADO FINAL:", "TODO OK" if ok_all else "HAY FALLOS")
sys.exit(0 if ok_all else 1)
