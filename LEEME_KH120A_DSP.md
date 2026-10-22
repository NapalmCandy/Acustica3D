# Neumann KH 120 A — corrección DSP en el PC

> ## 🔄 Actualización (21-10-2026): Equalizer APO descartado
> Equalizer APO queda descartado. La corrección va ahora en un **plugin propio, KH120A Corrector (VST3/CLAP)**, para el máster de Bitwig: ver `plugin/LEEME_PLUGIN.md`. Lleva los mismos filtros.
> - El programa de sistema (como SoundID "Systemwide") será la fase siguiente.
> - **Scarlett 2i2 de 2.ª generación (+10 dBu máx.):** pon el **Output level del KH en 108 dB**, no en 100.
> - **El sub es un ADAM Sub8**, no un Sub10.
> - **Escucha:** a ~1,2 m y a la altura de los oídos.
> - Las secciones 5.1 (Equalizer APO) y 6 (ganancias) de abajo quedan sustituidas por la guía del plugin.

> ## ⚠️ FILTROS PROVISIONALES
> Están hechos con un **modelo calibrado con datos publicados por Neumann y por terceros**, sin medir tus cajas ni tu sala.
> Corrigen lo que se conoce bien (el paso alto del reflex, el giro de fase del cruce y la protección subsónica).
> **No corrigen tu sala ni las diferencias entre unidades.** Cuando aparezca el micrófono, se rehacen con las medidas (sección 9).

Fecha: 2026-10-21 · Equipo: 2 × KH 120 A, Focusrite Scarlett 2i2, ADAM Sub10, Windows, hardcore/gabber a volumen alto.

---

## 1. Resumen: tus cuatro objetivos

| # | Objetivo | Qué se consigue con DSP en el PC | Qué NO |
|---|---|---|---|
| 1 | **Menos distorsión** | El filtro **LIN50** corta por debajo de la sintonía del puerto con 36 dB/oct. Con música fuerte (95 dB a 1 m) la excursión del cono a 25–40 Hz **baja de ~10 mm a ~3,4 mm** (fig. 9), y el limitador salta menos. | No baja la distorsión del woofer a un nivel dado. A tu volumen, **la gran mejora será quitarle el grave al KH y dárselo al Sub10** (sección 6). |
| 2 | **Más subgrave** | **EXT40** (−3 dB a 40 Hz) es viable solo hasta **~85 dB por caja a 1 m**. | A volumen de hardcore no es viable: el KH pasa del 3 % de THD por debajo de ~85 Hz a 95 dB. |
| 3 | **Respuesta plana** | Plana en el modelo: ±0,1 dB de 100 Hz a 10 kHz; −0,3 dB a 80 Hz y a 15 kHz; −2,2 dB a 20 kHz (la caída natural del tweeter, que no se realza). El KH 120 A ya es muy plano de serie (±1 dB). | Sala, escritorio y reflexiones: necesitan medidas, y los huecos no se corrigen nunca. |
| 4 | **Fase plana** | **Fase lineal de 20 Hz a 20 kHz** (±0,13°), incluidos el cruce y el paso alto del reflex. Latencia de 85 ms a 48 kHz. Hay versión de 1 ms que linealiza el cruce. | La fase plana en el grave trae **pre-respuesta** en el escalón (fig. 6). Escúchalo en A/B. |

**Recomendación para empezar:** `LIN50_faselineal` para escuchar y mezclar, y `LIN50_bajalatencia` para grabar, vídeo y juegos. Prueba `EXT40` solo a volumen moderado y nunca con el filtro de 85 Hz del Sub10 activado.

---

## 2. Fase 2: el modelo

Código en `src/` (Python con numpy, scipy, matplotlib y numba):

- `kh120a_model.py`: Thiele-Small de parámetros concentrados con fugas de caja y pérdidas lineales y no lineales del puerto; difracción por fuentes en los bordes; filtro LR4 a 2 kHz; caída del tweeter; simulación no lineal en el tiempo (RK4) con Bl(x), Kms(x), Le(x), fuerza de reluctancia, puerto no lineal y recorte del amplificador.
- `nl_tools.py` y `run_fase2.py`: búsqueda del SPL, mapas de THD, H2 y H3 en frecuencia y nivel, y límites de extensión.

### 2.1 Parámetros

Leyenda: **[N]** dato de Neumann · **[D]** dato de distribuidor · **[E]** estimado y calibrado por mí.

| Parámetro | Valor | Origen |
|---|---|---|
| Volumen interno | 6,5 L | [N/D] |
| Cruce | LR4 a 2 kHz | [D] (pendiente 24 dB/oct; tipo LR supuesto) |
| Infrasónico | 30 Hz, 6 dB/oct | [D] |
| Sd | 88 cm² | [E] |
| Re | 5,6 Ω | [E] |
| Le | 0,35 mH | [E] |
| Bl | 6,2 T·m | [E] |
| Mms | 11,5 g | [E] |
| fs | 38 Hz | [E] |
| Qts | 0,36 | [E] |
| Vas | 16,7 L | [E] |
| Fb (sintonía) | 45 Hz | [E] calibrado con −3 dB a 52 Hz y −6 dB a 46 Hz |
| Puertos | 14 cm² en total, longitud efectiva ≈ 32 cm | [E] |
| Realce electrónico de grave | +2,2 dB a 55 Hz, Q 1,8 | [E] necesario para la pendiente publicada |
| Xb (Bl al 82 %) | 6 mm (conservador) / 9 mm (optimista) | [E] |
| Umbral del limitador | 28 V de pico (≈ 50 W en 8 Ω) | [E] |
| Recorte del amplificador | 35,8 V de pico (≈ 80 W en 8 Ω) | [E] |

### 2.2 Calibración

| Dato publicado | Modelo |
|---|---|
| −2 / −3 / −6 dB a 54 / 52 / 46 Hz | −2,2 / −3,0 / −6,0 dB |
| −3 / −6 dB a 21 / 24 kHz | −3,1 / −5,9 dB |
| THD < 0,5 % a 95 dB en semiespacio (89 dB en 4π) por encima de 120 Hz | 0,33 % a 123 Hz con 87,5 dB (punto más cercano de la rejilla), y menos por encima (escenario conservador) |
| SPL máximo con 3 % de THD, media de 50–100 Hz: 104,8 dB en semiespacio | 99,1 dB (conservador) / 102,9 dB (optimista) |

Ningún conjunto de parámetros realista cumple a la vez las dos cifras de distorsión de Neumann. Los 104,8 dB exigirían unos 9 mm de excursión limpia a 63 Hz en un woofer de 5,25". Por eso doy **dos escenarios**:

- **Conservador:** cumple la especificación de THD > 120 Hz y la observación de Sound On Sound ("la distorsión sube mucho por debajo de 100 Hz").
- **Optimista:** se acerca a la cifra de grave de Neumann.

La verdad estará entre los dos. Las medidas lo dirán.

### 2.3 Hasta dónde se puede bajar sin pasar del umbral de THD ni disparar el limitador

Una caja, en eje, a 1 m, campo libre. Frecuencia más baja reproducible (fig. 10):

| SPL a 1 m | THD ≤ 1 % (cons. / opt.) | THD ≤ 3 % (cons. / opt.) |
|---|---|---|
| 80 dB | 41 / 38 Hz | 37 / 35 Hz |
| 85 dB | 47 / 40 Hz | 39 / 37 Hz |
| 90 dB | 87 / 66 Hz | 44 / 42 Hz |
| 95 dB | 133 / 95 Hz | 85 / 67 Hz |
| 100 dB | > 200 / 158 Hz | 163 / 158 Hz |

**Cómo leerlo en tu sala:** en el grave, las dos cajas juntas suman unos +6 dB, y la mesa y la sala otros +3 a +6 dB. Por eso **"85 dB por caja" equivale a unos 94–97 dB de grave en tu posición de escucha**. Si mezclas hardcore fuerte, estás en la fila de 90–95 dB, donde el woofer ya distorsiona por debajo de ~85 Hz.

Se confirma la lección de los Tannoy: en un woofer de 5,25" **el límite lo pone Sd·Xmax, no la caja**.

---

## 3. Fase 3: los filtros

### 3.1 Qué hacen

| | LIN50 | EXT40 |
|---|---|---|
| Objetivo en el grave | Butterworth 6.º orden, −3 dB a 50 Hz (≈ la caída de serie, pero 36 dB/oct por debajo) | Butterworth 6.º orden, −3 dB a 40 Hz |
| Realce máximo | +0,9 dB | +6,2 dB |
| Excursión por debajo de 40 Hz | **Mucho menor** que de serie | Mayor que de serie de 25 a 45 Hz |
| Uso | **Diario**, también a volumen alto | Solo a volumen moderado |

Las dos versiones de fase:

| | Fase lineal (FL) | Baja latencia (BL) |
|---|---|---|
| Qué linealiza | Todo: paso alto del reflex, infrasónico, cruce LR4 y caída ultrasónica del tweeter | Cruce y tweeter (de 100 Hz a 20 kHz con ±0,3° de error). El grave queda en fase mínima |
| Coeficientes | 8192 | 16384 (no añaden latencia) |
| **Latencia del filtro** | **85,3 ms a 48 kHz / 92,9 ms a 44,1 kHz** | **1,0 ms** |
| Para | Escuchar y mezclar | Grabar, vídeo y juegos |

La latencia total es la del filtro más la del búfer de Windows o del DAW.

En la versión BL, el retardo de grupo en el grave es algo mayor que el de serie (20 ms frente a 12 ms hacia 50 Hz, fig. 5). Es el precio de un subsónico más empinado con 1 ms de latencia.

### 3.2 Coeficientes necesarios y error de truncado (48 kHz)

Error medido desde 0,7·f_ext hasta 20 kHz (fig. 11):

| N | Latencia | Error de magnitud | Error de fase |
|---|---|---|---|
| 2048 | 21 ms | 2–3 dB ❌ | 12–20° ❌ |
| 4096 | 43 ms | 0,3 dB ⚠️ | 1,5–2° |
| **8192** | **85 ms** | **0,006–0,01 dB ✅** | **0,04° ✅** |
| 16384 | 171 ms | 0,0004 dB | 0,004° |

He elegido N = 8192 con el criterio de error ≤ 0,1 dB y ≤ 2°. Con 4096 la latencia se queda en 43 ms, pero hay 0,3 dB de error en el grave. Si los 85 ms te molestan mezclando, te lo genero.

### 3.3 Atenuación previa contra la saturación digital

**Todos los WAV ya llevan −12,0 dB en banda media.** Equalizer APO va con `Preamp: 0 dB`.

Por qué tanto:

- **Realce del filtro:** hasta +6,2 dB en EXT40.
- **Bombos de hardcore recortados a 0 dBFS:** se parecen a una onda cuadrada. Al filtrarles la fundamental o girarles la fase, los flancos se disparan por efecto de Gibbs. He medido hasta **+8,5 dBFS** con una cuadrada de 48 Hz y +6 dBFS con un bombo gabber sintético.
- **Por qué en analógico no pasa:** el paso alto del propio KH hace lo mismo, pero allí hay margen. En digital se recorta en el conversor de la Scarlett, que es justo distorsión añadida.

Con −12 dB, el peor caso queda por debajo de −0,5 dBFS, y el bombo de prueba sale entre −3,5 y −6 dBFS. Además, **los 8 filtros suenan al mismo nivel**, así que puedes cambiar entre ellos sin saltos.

---

## 4. Gráficas (`graficas/`)

Todas en eje, a 1 m, a 48 kHz, original frente a corregido. Resolución de 1/12 de octava.

| Fichero | Contenido |
|---|---|
| `fig01_modelo.png` | Modelo calibrado frente a los puntos de Neumann; difracción del frontal por fuentes en los bordes |
| `fig03_respuesta.png` | Magnitud: original, FL y BL (LIN50 y EXT40) |
| `fig04_fase.png` | Fase sin el retardo de la latencia |
| `fig05_retardo_grupo.png` | Retardo de grupo |
| `fig06_escalon.png` | Escalón (se ve la pre-respuesta de la versión FL) |
| `fig07_impulso.png` | Impulso |
| `fig08_thd_spl_constante.png` | THD, H2 y H3 a 80–100 dB, en los dos escenarios |
| `fig09_thd_programa.png` | THD y excursión con la MISMA música a 85 y 95 dB: original, LIN50 y EXT40 |
| `fig10_limites_extension.png` | Tabla 2.3 en gráfica |
| `fig11_error_truncado.png` | Error frente a número de coeficientes |

---

## 5. Instalación

### 5.1 Windows: Equalizer APO (para todo el audio de Windows)

1. Instala Equalizer APO desde https://sourceforge.net/projects/equalizerapo/. En el *Configurator*, marca **solo** la salida de la Scarlett 2i2 (por ejemplo, "Altavoces (Focusrite USB Audio)").
   - Si no funciona, vuelve al *Configurator* y prueba las "Troubleshooting options" (instalar como SFX/EFX).
2. Reinicia.
3. Copia los `.wav` de `filtros/` y `filtros/equalizer_apo/KH120A_config.txt` a `C:\Program Files\EqualizerAPO\config\`.
4. Abre `config.txt` en esa carpeta y añade al final: `Include: KH120A_config.txt`.
5. **Frecuencia de muestreo:** en Panel de control > Sonido > Focusrite > Propiedades > Opciones avanzadas, elige 24 bits a 48000 Hz. Pon lo mismo en Focusrite Control. Usa los WAV `_48k`; si trabajas a 44,1 kHz, usa los `_44k1`. **El WAV debe coincidir con la frecuencia del dispositivo.**
6. En `KH120A_config.txt`, deja activa una sola línea `Convolution:`.

### 5.2 En el DAW (ASIO)

**⚠️ Con ASIO, el audio del DAW NO pasa por Equalizer APO.** Para corregir dentro del DAW:

- **Convolución en el bus máster, como último plugin:**
  - **ReaVerb** (gratis, dentro de ReaPlugs de Cockos; funciona en cualquier DAW): carga el WAV y **desactiva "Normalize"**. El "Wet" a 0 dB y el "Dry" apagado.
  - Cualquier otro convolucionador que **no normalice** el impulso también vale.
- **Para mezclar:** fase lineal. **Para grabar con monitorización:** baja latencia, o desactiva el plugin.
- **⚠️ DESACTIVA el plugin al exportar o bouncear.** Si no, el máster sale con el grave cambiado y 12 dB más bajo. Lo más seguro es ponerlo en un bus de monitorización, si tu DAW lo tiene (Control Room en Cubase, Monitor FX en Reaper).
- **Nunca uses a la vez el plugin y Equalizer APO** (por ejemplo, si el DAW sale por WASAPI/WDM): el filtro se aplicaría dos veces.
- **Nota para Cubase:** su "Control Room" admite plugins solo en la escucha, lo ideal para esto. Dime qué DAW usas y te paso los pasos exactos.

### 5.3 Mac/Linux (por completar)

CamillaDSP 3.x con un dispositivo virtual (BlackHole en Mac; snd-aloop o PipeWire en Linux). Plantilla en `filtros/camilladsp/KH120A_camilladsp.yml`.

---

## 6. Ajustes del KH 120 A, ganancias y el Sub10

**Interruptores mientras uses estos filtros provisionales:**

| Control | Posición |
|---|---|
| Bass | **0 dB** |
| Low-Mid | **0 dB** |
| Treble | **0 dB** |
| Output level | **100 dB** |
| Input gain | **0 dB** |

- **Bass, Low-Mid y Treble:** el FIR supone la respuesta de serie. Con 1,5 m a la pared trasera y 2 m a las laterales, el manual no pide recorte de grave.
- **Output level:** sube a 108 dB solo si te falta volumen. A 108 dB, el techo lo pone el limitador del KH (unos 111 dB), no la Scarlett.
- **Low-Mid si suena embotado:** el escritorio refuerza 100–250 Hz. Si suena así, prueba −1,5 dB; Neumann sugiere recortar Low-Mid cuando hay mesa o consola.
- **Antes de medir:** anota los interruptores y no los toques ya.

**Ganancias:** la Scarlett 2i2 de 4.ª generación da +16 dBu a 0 dBFS (la 3.ª, parecido). Con −12 dB en el filtro y Output level a 100 dB, el máximo limpio es de unos 104 dB a 1 m por caja, más de lo que el woofer da limpio en grave. Controla el volumen con la rueda de la Scarlett.

**ADAM Sub10 (Mk2: filtro de 85 Hz conmutable en las salidas a satélites, corte de 50 a 150 Hz y fase de 0/180°):**

- **Con el filtro de 85 Hz activado** (KH conectados a las salidas del sub): **NO uses EXT40**. LIN50 funciona, pero la linealización de fase en el grave no será exacta, porque el modelo no incluye ese filtro.
- **Para juzgar estos filtros**, escucha primero los KH solos: sub apagado o al mínimo, y filtro de 85 Hz desactivado.
- **Para hardcore fuerte, la mejora de distorsión más grande** es que los KH no reproduzcan por debajo de 80–90 Hz y lo haga el Sub10 (10", con más de 113 dB de pico).
  - Se hará con medidas: cruce, retardo y fase del sub alineados, y un FIR que linealice el conjunto KH + sub.
  - La ubicación del sub y del puesto de escucha, en la sesión de la sala.

---

## 7. Advertencias de seguridad

1. **Baja el volumen antes de activar o desactivar el filtro.**
   - **Al desactivarlo:** el nivel sube 12 dB de golpe.
   - **Al activarlo:** el grave cambia.
2. **Nunca dos correcciones a la vez** (Equalizer APO más el plugin del DAW, o dos líneas `Convolution`). Con EXT40 duplicado serían +12 dB a 40 Hz.
3. **EXT40 a volumen alto:**
   - el cono pasa de Xb (fig. 9);
   - la distorsión supera el 10 %;
   - el limitador "bombea".
   - Si lo oyes, vuelve a LIN50.
4. **Frecuencia equivocada:** un WAV de 48 kHz a 44,1 kHz desplaza la corrección un 8,8 % hacia abajo.
5. **No exportes con el plugin en el máster.**
6. **Latencia de 85–93 ms en la versión FL:** el vídeo se desincroniza y tocar en directo es incómodo. Usa BL.
7. **Si Windows o Equalizer APO dejan de procesar** (una actualización de Windows a veces desinstala APO), oirás el KH de serie y 12 dB más alto. Vuelve a ejecutar el *Configurator*.

---

## 8. Lo que NO se puede corregir

- **La distorsión física del woofer, el puerto y el amplificador.** Un FIR es lineal: solo puede no empeorarla, quitando subgrave inútil y sin realzar donde el cono está al límite. Lo que la reduce es bajar el nivel o repartir el grave con el sub.
- **La dispersión y directividad** (guía MMD, cruce): el EQ cambia todos los ángulos a la vez. Se corrige en eje y se deja fuera de eje como es.
- **Las reflexiones y los huecos de la sala.**
  - Con 1,5 m a la pared trasera hay una **cancelación hacia 57 Hz** (c/4d), justo en la fundamental del bombo gabber.
  - La mesa crea un peine en 100–300 Hz.
  - Ninguna de las dos cosas se arregla con EQ: realzar un hueco solo gasta excursión y amplificador. Se tratan con colocación y paneles (sesión de la sala).
- **La corrección de sala por debajo de 300 Hz** solo recortará picos (modos). `src/room_correction.py` está listo y probado, esperando medidas.

---

## 9. Procedimiento de medida con REW (cuando aparezca el micrófono)

**Material:**
- Micrófono Sonarworks SoundID Reference en la entrada 1 de la Scarlett, con **48 V activados**.
- REW (gratuito, https://www.roomeqwizard.com).

**Preparación:**
1. **Calibración individual.** Descarga de Sonarworks el fichero de calibración de **tu número de serie**, que está impreso en el micrófono. En REW: *Preferences > Cal files > Mic/meter cal file*. Si viene en un formato que REW no lee, pásamelo y lo convierto.
2. **Desactiva toda corrección:** Equalizer APO sin `Convolution` y sin plugins. Se mide el KH **de serie**.
3. **Interruptores** según la sección 6, anotados. **Sub apagado** para medir los KH.
4. **REW** a 48 kHz, driver ASIO de la Focusrite, salida 1 o 2 según la caja y entrada 1.
   - **Referencia de tiempo:** la 2i2 no tiene salida libre para loopback. Activa la **referencia de tiempo acústica** (*Analysis > Timing reference: acoustic*) usando la otra caja, o mide siempre con la misma configuración.
5. **Barrido:** de 10 Hz a 24 kHz, longitud 1M (unos 22 s). Nivel: unos 80 dB en el micrófono a 1 m (revísalo con *Check levels*).

**Medidas:**

**A. Altavoz a 1 m, con ventana** (de cada caja):
- Caja sobre un pie o una mesa en el centro de la sala, a ~1,2 m del suelo y lejos de paredes.
- Micrófono a 1 m en el eje del tweeter, apuntando a la caja.
- En REW, ventana del impulso: izquierda de 0,5 ms; derecha unos 0,2 ms antes de la primera reflexión (suelo, unos 4–5 ms en esa colocación). Será válida por encima de ~250–300 Hz.
- Haz además ±15° y ±30° en horizontal si te animas (para ver la directividad).

**B. Campo cercano para el grave** (de cada caja):
- Micrófono a ~1 cm de la rejilla, en el centro del woofer.
- Después, a ~1 cm de **cada puerto frontal**.
- No las sumes tú: expórtalas por separado. Yo las sumo con el área y las empalmo con la A usando el modelo de difracción.
- Haz también un barrido a más nivel (85 y 90 dB equivalentes a 1 m) y guarda la distorsión de REW: sirve para **validar el modelo no lineal** y decidir entre el escenario conservador y el optimista.

**C. Posición de escucha** (la sala):
- Micrófono a la altura de los oídos, apuntando entre las dos cajas.
- Medidas:
  - L sola, R sola, L+R;
  - sub solo, y L+R+sub si lo integramos ya;
  - 5 a 9 puntos en ±20–30 cm alrededor de la cabeza, para promediar.
- Con los paneles y el plano de SketchUp, esto se cruzará en la sesión de la sala.

**Exportación** (envíame todo):
- *File > Save all measurements* (fichero `.mdat`): lo más cómodo.
- Además, de cada medida, *File > Export > Export measurement as text*: sin suavizado, todas las frecuencias, con fase.
- *File > Export > Export impulse response as WAV*: 32 bits float, 48 kHz, sin normalizar.
- Nombres claros, por ejemplo `L_1m_gated.txt`, `L_nf_woofer.txt`, `L_nf_puerto_izq.txt`, `escucha_L_p1.txt`…
- Una nota con: interruptores, distancias, altura del micrófono, posición del sub y nivel del barrido.

Con eso rehago:
- el modelo (Xb, Fb y T/S medidos);
- el FIR del altavoz (por caja, L y R por separado);
- la corrección de sala solo con recortes por debajo de 300 Hz;
- y, si quieres, la integración con el Sub10.

---

## 10. Datos que me faltan

1. **Qué DAW usas**, y si usas ASIO.
2. **Distancia de escucha, separación entre monitores y altura** (¿apuntan a los oídos?).
3. **Generación de la Scarlett 2i2** (3.ª o 4.ª) y la **frecuencia de muestreo** habitual.
4. **ADAM Sub10: ¿Mk1 o Mk2? ¿Cómo está cableado?** ¿Los KH van desde las salidas a satélites del sub? ¿Filtro de 85 Hz activado? ¿Posición del corte, de la fase y del nivel?
5. Si puedes, **el nivel al que escuchas** (una app de sonómetro en ponderación C sirve de referencia).

---

## 11. Estructura de la carpeta

```
kh120a-dsp/
├─ LEEME_KH120A_DSP.md            ← esta guía
├─ fase1_datos_KH120A.md          ← ficha con fuentes
├─ filtros/                       ← 8 WAV PROVISIONALES (float32, estéreo L=R, −12 dB)
│  ├─ equalizer_apo/KH120A_config.txt
│  └─ camilladsp/KH120A_camilladsp.yml
├─ graficas/                      ← fig01…fig11
├─ datos/                         ← resultados (JSON) y mapas no lineales (.npy)
└─ src/                           ← kh120a_model.py, nl_tools.py, run_fase2.py, fir_design.py, plots.py, room_correction.py
```

Para regenerar todo: `python3 src/run_fase2.py && python3 src/fir_design.py && python3 src/plots.py`

**Fuentes principales:**
- [Neumann, KH 120 A G](https://www.neumann.com/en-us/products/historical/kh-120-a-g)
- [Sound On Sound, KH120A & KH810](https://www.soundonsound.com/reviews/neumann-kh120a-kh810)
- [ASR, dominikz: KH 120A spinorama](https://www.audiosciencereview.com/forum/index.php?threads/neumann-kh-120a-spinorama-and-misc-measurements.26896/)
- [spinorama.org, datos Klippel de Neumann](https://www.spinorama.org/speakers/Neumann%20KH%20120A/Neumann/index_vendor-klippel.html)
- [Expandore, SPL máximo](https://expandore.com/professional-audio/Neumann/studio_monitor_systems/sms_1.htm)
- [ADAM Sub10 Mk2](https://www.fullcompass.com/prod/114322-adam-audio-sub10-mk2-10-200w-active-subwoofer)
- [Scarlett 2i2 de 4.ª generación](https://djbox.ie/collections/music-production/products/scarlett-2i2-4th-gen)
- [Referencia de configuración de Equalizer APO](https://sourceforge.net/p/equalizerapo/wiki/Configuration%20reference/)

El resto, en `fase1_datos_KH120A.md`.
