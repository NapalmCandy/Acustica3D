# Neumann KH 120 A — Fase 1: datos recopilados

Proyecto: corrección DSP en el PC (FIR) para Neumann KH 120 A.
Fecha: 2026-10-21. Estado: datos públicos; **sin medidas propias todavía**.

Leyenda de fiabilidad:
- **[N]** dato oficial de Neumann (página "historical" del producto o ficha técnica reproducida por distribuidores).
- **[R]** revista o medición independiente.
- **[D]** solo lo dan tiendas o distribuidores; no verificado contra Neumann.
- **[E]** estimación mía para el modelo (Fase 2), pendiente de calibrar.

Nota: curl y WebFetch están bloqueados en este entorno (403 / DNS) para neumann.com,
soundonsound.com, manualslib, ASR, etc. Todo lo de aquí sale de WebSearch, así que
conviene contrastarlo con el manual en PDF cuando sea posible.

---

## 0. Versión: no confundir

| Modelo | Electrónica | Notas |
|---|---|---|
| **KH 120 A** (G = antracita, W = blanco) | **Analógica**: filtro analógico, clase AB | Es el que dice tener el usuario. Descatalogado (página "historical" de Neumann). |
| KH 120 D | Analógica + entrada digital AES3 y retardo | Variante con entrada digital. |
| KH 120 II / II AES67 | **DSP**: cruce de fase lineal, FIR 120 Hz–16 kHz, limitador de excursión | Posterior. 145 W + 100 W, −3 dB a 44 Hz, 116,8 dB SPL. **No mezclar sus datos.** |

Varias tiendas mezclan datos del II con el A (44 Hz, "soft clip", "excursion limiter").
Esos datos se descartan para el A.

**Pendiente:** confirmar con la etiqueta trasera (modelo, n.º de serie y fecha).

## 1. Woofer
- 5,25" (130–133 mm de chasis) [N/D]. "Long-throw", cono **sándwich de composite** [D].
- Diámetro efectivo ≈ 105 mm → **Sd ≈ 85–90 cm²** [E].
- **Xmax: no publicado.** Thiele-Small: no publicados (driver hecho a medida). Supuesto inicial: Xmax ≈ 4–5 mm (pico) [E].
- La rejilla metálica no se puede quitar, así que no se puede medir el cono de cerca directamente (dominikz, ASR) [R].

## 2. Tweeter y guía de ondas
- Cúpula de **tela de titanio** de 1" (25 mm) [D].
- Guía de ondas **MMD** (Mathematically Modelled Dispersion), que controla sobre todo la directividad vertical y reduce el rebote en la mesa o la consola [R: SOS 2012].
- Se ve una pequeña resonancia hacia **1,6 kHz**, en la zona del cruce, también fuera de eje [R: dominikz/ASR].

## 3. Electrónica
- Biamplificado, **clase AB**, 50 W continuos / 80 W de pico por vía [N/D] (Neumann habla de "80 W" cada uno).
- Filtro **analógico** a **2,0 kHz, 24 dB/oct** (4.º orden) [D]; una tienda dice 1,7 kHz (probablemente confunde con el KH 120 II).
  Supuesto para el modelo: Linkwitz-Riley de 4.º orden [E].
- **Filtro infrasónico: 30 Hz, 6 dB/oct** [D] (un solo listado).
- **Protecciones:** limitadores de pico y térmico independientes para woofer y tweeter [N/D].
  → **Clave para el realce de graves:** el limitador de pico del woofer se activará antes en la zona realzada.
- Entrada XLR balanceada. Consumo: 20 W en reposo y 200 W a plena potencia [D].
- Ruido propio < 20 dB(A) a 10 cm (con 100 dB SPL por 0 dBu) [N].

## 4. Controles traseros
| Control | Posiciones | Notas |
|---|---|---|
| Bass | 0 / −2,5 / −5 / −7,5 dB | Estante de 2.º orden en 183 Hz, Q 0,62: empieza hacia 400 Hz y llega al nivel completo por debajo de ~60 Hz [N: gráfica del manual, pág. 25, ajustada a sus trazos vectoriales] |
| Low-Mid | 0 / −1,5 / −3 / −4,5 dB | Campana ancha en 260 Hz, Q 0,36, para la carga de una mesa o consola [N: gráfica del manual, pág. 25] |
| Treble | +1 / 0 / −1 / −2 dB | Estante en 5,4 kHz, Q 0,84 [N: gráfica del manual, pág. 25] |
| Output level | 94 / 100 / 108 / 114 dB SPL a 1 m con 0 dBu | Impedancia de entrada: 10 kΩ en 94/108 y 20 kΩ en 100/114 [D] |
| Input gain | 0 … −15 dB (rotativo) | [D] |

Ejemplos del manual: exento en sala sin tratar → Bass −2,5, Treble −1; sala pequeña con
reflexiones laterales fuertes → Bass −5 [manual vía WebSearch].

## 5. Caja
- Aluminio fundido. **Volumen interno 6,5 L** (externo 9,7 L) [R: SOS + D].
- 277 × 182 × 220 mm (alto × ancho × fondo). 6,2 kg [N] (otra fuente: 6,4 kg).
- **Bass reflex con puertos frontales** "de gran sección, flujo optimizado y resonancia de tubo amortiguada" [N].
- Sintonía no publicada. SOS ve una **resonancia de puerto hacia 60 Hz** en retardo de grupo y waterfall [R].
  Supuesto: Fb ≈ 50–55 Hz [E].

## 6. Prestaciones
| Magnitud | Valor | Fuente |
|---|---|---|
| Respuesta en campo libre ±2 dB | 54 Hz – 20 kHz | [N/D] |
| ±3 dB | **52 Hz – 21 kHz** | [N] |
| ±6 dB | 46 Hz – 24 kHz | [N] |
| SPL máx. (3 % THD, 1 m, media de 100 Hz–6 kHz) | 111,1 dB semiespacio / 105,1 dB espacio libre | [N] |
| **SPL máx. en grave (3 % THD, media de 50–100 Hz)** | **104,8 dB semiespacio** (≈ 98,8 dB espacio libre) | [N] |
| THD < 0,5 % | a 95 dB SPL, 1 m, semiespacio, **por encima de 120 Hz** (otras fuentes: > 100 Hz) | [N/D] |
| Tolerancia de fabricación (100 Hz–10 kHz) | ±0,97 dB (el 100 % de unidades), ±0,40 (80 %), ±0,23 (50 %) | [N] |
| Variación entre unidades medida | < 1 dB, sobre todo en la zona del cruce | [R: dominikz] |
| Directividad | Uniforme: fuera de eje mantiene la forma y solo cambia la pendiente | [R: dominikz] |
| Puntuación de preferencia (Olive) | 6,66 (8,67 con subwoofer), según los datos Klippel de Neumann | [R: spinorama.org] |
| Distorsión | "Respetable hasta ~100 Hz; por debajo sube mucho"; predomina la 2.ª armónica | [R: SOS, Rockwell] |
| Fase y retardo de grupo | **No publicados.** Filtro analógico: no es de fase lineal. Pico de retardo de grupo hacia 60 Hz (puerto) | [R: SOS] |

## 7. Conclusiones preliminares para el diseño
1. **Fase:** sistema de fase mínima con
   - filtro LR4 a 2 kHz (unos −360° de giro y algo menos de 0,3 ms de retardo de grupo en el cruce),
   - paso alto de 4.º orden del reflex, más el infrasónico de 1.er orden (giro de fase de hasta ~450° en el grave; retardo de grupo de
     **unos 10–15 ms a 50–60 Hz**) [E].
   Un FIR puede linealizar todo eso, a cambio de latencia (estimación: 40–90 ms a 48 kHz según hasta dónde baje la corrección).
2. **Subgrave:** limitado por Sd·Xmax, no por la caja. Cálculo rápido [E] (Sd = 87 cm², Xmax = 4,5 mm, semiespacio, solo el cono):
   con el desplazamiento máximo se llega a ≈ 88 dB SPL (seno) a 50 Hz, ≈ 84 dB a 40 Hz y ≈ 79 dB a 30 Hz (−12 dB/oct).
   Por debajo de la sintonía del puerto el cono se descarga y las cosas empeoran.
   **Orden de magnitud preliminar:** a 80 dB se puede bajar a ~40 Hz, a 85 dB a ~45 Hz y a 90 dB no conviene extender
   (se queda en los 52 Hz de serie). Esto se rehará con el modelo no lineal en la Fase 2.
3. **Distorsión:** el FIR no reduce la distorsión del driver. Solo puede no aumentarla (no realzar
   donde el cono está al límite) y apartar energía del limitador. El SPL de escucha es la palanca principal.
4. **Limitador:** cualquier realce de grave hay que compensarlo con atenuación digital previa, y el
   interruptor Output level debe estar en el valor más bajo que permita el volumen de escucha.

## Fuentes
- Neumann, página "historical" KH 120 A G: https://www.neumann.com/en-us/products/historical/kh-120-a-g
- Neumann, KH 120 A W: https://www.neumann.com/en-us/products/historical/kh-120-a-w
- Neumann, FAQ KH 120: https://www.neumann.com/globalassets/digizuite/15357-en-monitors-faq-kh-120-answers_en.pdf
- Manual KH 120 A (copias): https://www.manualslib.com/manual/756379/Neumann-Berlin-Kh-120-A.html · https://www.avbroadcast.fr/media/productfile/n/e/neumann-kh_120-enceinte-manuel.pdf · https://www.blackflagstudio.com/manuals/249.pdf
- Sound On Sound, KH120A & KH810 (2012): https://www.soundonsound.com/reviews/neumann-kh120a-kh810 (PDF: https://www.neumann.com/globalassets/digizuite/17428-en-review_kh120-kh810_soundonsound_2012_04.pdf)
- Studio Magazin 2010 (EN): https://www.Neumann.com/globalassets/digizuite/10460-en-docu0122_kh120_review_studiomagazin_en_2010-12.pdf
- ASR, dominikz, "Neumann KH 120A – spinorama and misc measurements": https://www.audiosciencereview.com/forum/index.php?threads/neumann-kh-120a-spinorama-and-misc-measurements.26896/
- spinorama.org, KH 120A (Klippel de Neumann): https://www.spinorama.org/speakers/Neumann%20KH%20120A/Neumann/index_vendor-klippel.html
- spinorama.org, KH 120A (dominikz): https://www.spinorama.org/speakers/Neumann%20KH%20120A/Misc/index_misc-dominikz.html
- spinorama.org, KH 120 II (ASR), solo como comparación: https://www.spinorama.org/speakers/Neumann%20KH%20120%20II/ASR/index_asr.html
- Ken Rockwell, KH 120 A & D: https://kenrockwell.com/audio/neumann/kh-120-a.htm
- hifi-selbstbau, KH-120A: https://hifi-selbstbau.de/index.php/verschiedenes/fertiglautsprecher/neumann-kh-120a
- delamar (DE): https://www.delamar.de/test/neumann-kh-120-a-testbericht/
- Expandore (SMS-1 / max SPL): https://expandore.com/professional-audio/Neumann/studio_monitor_systems/sms_1.htm
- Sound Easy (ficha): https://www.soundseasy.com.au/products/neumann-kh-120-a
- Gearank (cruce 2 kHz/24 dB): https://www.gearank.com/gear/neumann-kh-120-525-inch-powered-studio-monitor/
- Muzeekworld (6,5 L, infrasónico): https://muzeekworld.com/products/magnetically-shielded-6-5-liters-80-80-w-111-1-db-spl-52-21k-hz-metallic-anthracite
