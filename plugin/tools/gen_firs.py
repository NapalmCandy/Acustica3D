"""Genera la cabecera C++ con los FIR PROVISIONALES del KH 120 A (4 frecuencias de muestreo).
Mismo diseño que src/fir_design.py; todos normalizados a -12,0 dB a 1 kHz."""
import os, sys, json
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "src"))
import fir_design as fd

ATT_DB = 12.0
RATES = [44100, 48000, 88200, 96000]
VARS = [("LIN50", 50.0), ("EXT40", 40.0)]


def norm(h, fs):
    H = np.fft.rfft(h, 1 << 18)
    f = np.fft.rfftfreq(1 << 18, 1 / fs)
    g1k = np.abs(H[np.argmin(abs(f - 1000))])
    return h * (10 ** (-ATT_DB / 20) / g1k)


def main():
    out = []
    meta = {}
    out.append("// GENERADO por tools/gen_firs.py - NO EDITAR A MANO\n// FIR PROVISIONALES KH 120 A (modelo calibrado con datos publicados, sin medidas)\n#pragma once\n#include <cstdint>\nnamespace khfir {\n")
    table = []
    for fs in RATES:
        for var, fext in VARS:
            h_big, C = fd.ideal_linear(fs, fext)
            Ns = [8192, 16384, 32768] if fs > 50000 else [4096, 8192, 16384]
            rows = fd.trunc_error(fs, fext, h_big, C, Ns)
            n_fl = fd.pick_N(rows)
            h_fl = norm(fd.truncate_centered(h_big, n_fl), fs)
            n_bl = 16384 if fs < 50000 else 32768
            h_bl, d = fd.low_latency(fs, fext, 1.0, n_bl)
            h_bl = norm(h_bl, fs)
            pk_fl = fd.worst_square_peak_db(h_fl, fs, n_f=24)[0]
            pk_bl = fd.worst_square_peak_db(h_bl, fs, n_f=24)[0]
            khz = {44100: "44k1", 48000: "48k", 88200: "88k2", 96000: "96k"}[fs]
            for kind, h, fname in (("FL", h_fl, "faselineal"), ("BL", h_bl, "bajalatencia")):
                # los WAV salen de los MISMOS coeficientes que el plugin
                fd.write_wav(os.path.join(ROOT, "filtros", f"KH120A_PROVISIONAL_{var}_{fname}_{khz}.wav"), h.astype(np.float32), fs)
            for kind, h, lat in (("FL", h_fl, n_fl // 2), ("BL", h_bl, d)):
                name = f"{var}_{kind}_{fs}"
                out.append(f"static const float {name}[{len(h)}] = {{")
                vals = ",".join(f"{float(v):.9e}f" for v in h.astype(np.float32))
                out.append(vals + "};\n")
                table.append((fs, var, kind, name, len(h), lat))
            meta[f"{var}_{fs}"] = dict(N_FL=n_fl, lat_FL=n_fl // 2, N_BL=n_bl, lat_BL=d,
                                       peor_cuadrada_FL_dBFS=pk_fl, peor_cuadrada_BL_dBFS=pk_bl,
                                       err_trunc=[r for r in rows if r["N"] == n_fl][0])
            print(fs, var, "FL", n_fl, "BL", n_bl, "d", d, "peor cuadrada FL %.2f BL %.2f dBFS" % (pk_fl, pk_bl), flush=True)
    out.append("struct Fir { uint32_t fs; int variant; int phase; const float* h; uint32_t n; uint32_t latency; };")
    out.append("// variant: 0=LIN50 1=EXT40 · phase: 0=fase lineal 1=baja latencia")
    out.append(f"static const Fir kFirs[{len(table)}] = {{")
    for fs, var, kind, name, n, lat in table:
        out.append(f"  {{{fs}, {0 if var == 'LIN50' else 1}, {0 if kind == 'FL' else 1}, {name}, {n}, {lat}}},")
    out.append("};\n")
    out.append(f"static const float kAttenuationDb = {ATT_DB:.1f}f;\n}} // namespace khfir\n")
    dst = os.path.join(os.path.dirname(HERE), "src", "kh_firs.hpp")
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    open(dst, "w").write("\n".join(out))
    json.dump(meta, open(os.path.join(os.path.dirname(HERE), "src", "kh_firs_meta.json"), "w"), indent=1)
    print("escrito", dst, os.path.getsize(dst) // 1024, "KB")


if __name__ == "__main__":
    main()
