"""Lee los diagramas de directividad (isobaras) del manual del Neumann KH 120 y genera
src/lib/hf/kh120Directivity.ts.

Uso:
  pdftoppm -r 400 -f 25 -l 25 -png manual_kh120.pdf p     # la página «III» del apéndice
  python3 scripts/kh120_directividad.py p-25.png

Cada banda de gris del diagrama es un escalón de 3 dB (leyenda): se clasifica el gris de cada punto,
se buscan los ángulos donde se cruza cada umbral (−3, −6, …) y se interpola entre ellos, sin salir de la
banda que se ve en ese ángulo (tras un nulo el nivel vuelve a subir). Se lee hasta 85° y 19 kHz (en
90° y 20 kHz está el marco). Por debajo de 315 Hz todo el diagrama está entre 0 y −3 dB.
"""
import json, math, statistics, sys
from PIL import Image

SH = [59, 86, 111, 134, 156, 177, 197, 217]  # gris de cada banda: −24…−21, …, −6…−3, ≥ −3 dB
FREQS = [125 * 2 ** (i / 3) for i in range(23)]
ANG = list(range(0, 91, 10))


def band(v):
    return min(range(8), key=lambda i: abs(SH[i] - v))


def table(im, xl, xr, y90, y0, ym90):
    def px(x, y):
        return statistics.median([im.getpixel((x + dx, y + dy)) for dx in range(-3, 4) for dy in range(-2, 3)])

    out = {'up': [], 'down': []}
    for f in FREQS:
        x = int(round(xl + (xr - xl) * math.log(min(f, 19000) / 125) / math.log(20000 / 125)))
        x = max(xl + 8, min(xr - 8, x))
        for side, yend in (('up', y90), ('down', ym90)):
            n = abs(yend - y0)
            bands = [(90 * k / n, band(px(x, y0 + (k if yend > y0 else -k)))) for k in range(int(n * 85 / 90) + 1)]
            cross = {}
            for a, b in bands:
                for t in range(1, 8):
                    if -3 * (7 - b) <= -3 * t and t not in cross:
                        cross[t] = a
            pts = [(0.0, 0.0)]
            for a, d in sorted((a, -3 * t) for t, a in cross.items()):
                if a >= pts[-1][0] and d <= pts[-1][1]:
                    pts.append((a, d))
            row = []
            for a in ANG:
                v = None
                for (a0, d0), (a1, d1) in zip(pts, pts[1:]):
                    if a0 <= a <= a1:
                        v = d0 + (d1 - d0) * (a - a0) / max(1e-9, a1 - a0)
                        break
                if v is None:
                    v = pts[-1][1] - 1.5
                b = min(bands, key=lambda t: abs(t[0] - min(a, 85)))[1]
                hi = 0.0 if b == 7 else -3.0 * (7 - b)
                row.append(round(min(hi, max(hi - 3, v)), 1))
            out[side].append(row)
    for T in out.values():
        for i, f in enumerate(FREQS):
            if f <= 320:
                T[i] = [round(-1.5 * a / 90, 1) for a in ANG]
    return out


page = Image.open(sys.argv[1]).rotate(-90, expand=True).convert('L')
# recortes (en la página girada, a 400 ppp) y ejes de cada diagrama dentro del recorte
hor = table(page.crop((600, 1880, 2240, 2880)), 90, 1502, 80, 462, 845)
ver = table(page.crop((2320, 1880, 3960, 2880)), 80, 1505, 72, 459, 843)
H = [[round((u + d) / 2, 1) for u, d in zip(hor['up'][i], hor['down'][i])] for i in range(len(FREQS))]
print(json.dumps({'freqs': [round(f) for f in FREQS], 'angles': ANG, 'hor': H, 'up': ver['up'], 'down': ver['down']}))
