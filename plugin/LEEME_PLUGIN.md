# KH120A Corrector — plugin VST3 (y CLAP) · v0.1.1 PROVISIONAL

Plugin propio con la corrección del Neumann KH 120 A, para probarla en el **máster de Bitwig** antes de hacer el programa de sistema (como SoundID Reference "Systemwide").

> ⚠️ **Filtros PROVISIONALES:** salen del modelo calibrado con datos publicados, sin medir tus cajas ni tu sala. Cuando midamos con el micrófono, se regenera el plugin con los filtros definitivos (por caja, L y R).

## Instalación (Windows)

El zip trae el plugin de dos formas. Elige **una**:

**A. Arrastrar y soltar (lo más rápido para probar)**
1. Descomprime el zip: clic derecho > *Extraer todo*.
2. Arrastra a Bitwig el **archivo** `KH120ACorrector.vst3` que está suelto en la carpeta principal (1,5 MB). No arrastres la carpeta `instalar_en_sistema`.
3. O arrastra `KH120ACorrector.clap`, que también es un solo archivo.

**B. Instalación en el sistema (para quedarse)**
1. Cierra Bitwig.
2. Copia la **carpeta** `instalar_en_sistema\KH120ACorrector.vst3` entera a `C:\Program Files\Common Files\VST3\`. Es el formato oficial de VST3; Bitwig la encuentra al escanear, pero **no se puede arrastrar**.
3. Opcional: copia `KH120ACorrector.clap` a `C:\Program Files\Common Files\CLAP\` (créala si no existe).
4. Abre Bitwig. Si no aparece, vuelve a escanear en *Settings > Locations*.

**Después, en los dos casos:**
- *Settings > Audio*: driver ASIO de la Focusrite, **48 kHz** (o 44,1 kHz).
- Pon **KH120A Corrector** como **último dispositivo del máster**.

**Si Windows lo bloquea:** antes de descomprimir, clic derecho sobre el zip > *Propiedades* > marca *Desbloquear* > Aceptar, y vuelve a extraer.

No tiene ventana propia: los controles salen en el panel de parámetros del dispositivo en Bitwig.

## Controles

| Parámetro | Valores | Para qué |
|---|---|---|
| **Filtro** | LIN50 (por defecto) / EXT40 | LIN50 para el día a día, también fuerte. EXT40 extiende el grave a 40 Hz, **solo a volumen moderado** (≤ 85 dB por caja a 1 m). |
| **Fase** | Fase lineal (por defecto) / Baja latencia | Fase lineal para escuchar y mezclar. Baja latencia para grabar. |
| **Bypass seguro (−12 dB)** | No / Sí | Quita la corrección **sin cambiar el volumen ni la latencia**, para comparar en A/B. |
| **Limitador de seguridad** | Sí (por defecto) / No | Tope a −0,5 dBFS, con anticipación de 0,7 ms. No debería actuar nunca con música normal. |
| **Recorte de salida** | de −24 a 0 dB | Atenuación extra. No permite subir. |
| *Pico de salida* | lectura | Pico en dBFS. |
| *Reducción del limitador* | lectura | Si se mueve de 0 dB, algo llega demasiado fuerte. |
| *Latencia* | lectura | En ms. Bitwig la compensa sola. |
| *Estado* | lectura | "Frecuencia no soportada" si el proyecto no está a 44,1, 48, 88,2 o 96 kHz. En ese caso solo atenúa −12 dB, sin corrección. |

**Latencias medidas** (bloque interno + FIR + limitador):

| Modo | 48 kHz | 44,1 kHz |
|---|---|---|
| Fase lineal | 87,3 ms | 95,1 ms |
| Baja latencia | 3,0 ms | 3,2 ms |

A 88,2 y 96 kHz las latencias en ms son las mismas que a 44,1 y 48 kHz.

**Cambios en marcha:** al cambiar Filtro o Fase hay un fundido corto (15 ms) a silencio y vuelta, y una pausa igual a la latencia del filtro nuevo. Así no hay golpes. Cambiar la Fase cambia la latencia; Bitwig la recompensa, pero puede dar un pequeño corte.

## ⚠️ Seguridad

- **Todo suena 12 dB más bajo a propósito.** Es el margen para que los bombos recortados a 0 dBFS no saturen el conversor después del filtro. Compénsalo con la rueda de la Scarlett o con el Output level del KH (ver abajo). **No lo compenses subiendo la ganancia dentro de Bitwig después del plugin.**
- **DESACTIVA el plugin antes de exportar o bouncear** (botón de encendido del dispositivo). Si se te olvida, el fichero exportado saldrá 12 dB más bajo y con el grave cambiado. Es fácil de notar, pero revísalo siempre.
- **Antes de quitar o desactivar el plugin, baja el volumen:** sin él, todo sube 12 dB de golpe.
- **Con EXT40 a volumen alto**, el cono pasa de su recorrido limpio. Si oyes que el grave "rompe" o "bombea", vuelve a LIN50.
- **El audio de Windows** (navegador, Spotify…) **no pasa por el plugin.** Eso lo hará el programa de sistema (siguiente fase).

## Ganancias con tu Scarlett 2i2 de 2.ª generación

La 2i2 de 2.ª gen. da unos **+10 dBu** a 0 dBFS. Con los −12 dB del plugin, el máximo queda en unos −2 dBu.

Pon el **Output level del KH en 108 dB** (Input gain en 0). Así llegas a unos 106 dB de pico a 1 m por caja, el límite real del KH 120 A. Con 100 dB te quedarías en ~98 dB, que para hardcore se puede quedar corto.

Interruptores Bass, Low-Mid y Treble a 0, como en la guía.

## Sub8

Para juzgar el plugin, prueba primero los KH **sin el Sub8** (apagado o al mínimo, y con el filtro de 85 Hz de las salidas de satélite **desactivado**).

Con el filtro de 85 Hz activo, no uses EXT40. LIN50 funciona, pero su corrección de fase en el grave no será exacta, porque el modelo no incluye ese filtro. La integración del sub se hará midiendo.

## Cómo está probado

Se compila desde la misma fuente para Windows (MinGW, enlazado estático) y para Linux (para poder probarlo aquí):

- **Host VST3 real (pedalboard):** 26 pruebas, todas superadas.
  - Salida idéntica a la convolución de referencia en los 16 casos (2 filtros × 2 fases × 44,1/48/88,2/96 kHz), con un error de −128 a −131 dB.
  - Bypass exacto a −12 dB.
  - El limitador deja +6 dBFS en −0,50 dBFS.
  - NaN/Inf en la entrada no se propagan.
  - Frecuencia no soportada → −12 dB.
  - Cambios en caliente sin picos ni chasquidos.
  - CPU de ~1–1,5 % de un núcleo.
- **Validador oficial de Steinberg (VST3 SDK 3.8.1):** **47/47 pruebas superadas** tanto en la versión de Linux como en **la de Windows**, esta última con el validador de Windows ejecutado con Wine. Informes completos en `pruebas/`.
- **Archivo suelto `.vst3` (para arrastrar):** las mismas 47 pruebas funcionales superadas. El validador añade un único aviso, "no es una carpeta-paquete": es esperado, porque ese archivo es precisamente el formato de un solo archivo.

## Código

| Ruta | Contenido |
|---|---|
| `src/kh_core.hpp` | Núcleo DSP **independiente del framework** (convolución particionada con PFFFT, limitador, bypass, fundidos). Se puede llevar tal cual a JUCE, iPlug2 o a la app de sistema. |
| `src/kh_firs.hpp` | Coeficientes generados por `tools/gen_firs.py` (no se editan a mano). |
| `kh120a_corrector/` | Envoltorio DPF (VST3/CLAP), `Makefile`. |
| `tools/test_plugin.py` | Batería de pruebas. |

Para compilar:
- **Windows (cruzado):** `make -C kh120a_corrector WINDOWS=true CC=x86_64-w64-mingw32-gcc-posix CXX=x86_64-w64-mingw32-g++-posix DPF_TARGET_DIR=../bin-win DPF_BUILD_DIR=../build-win/KH120ACorrector`
- **Linux:** `make`

**Licencias de terceros:** DPF (ISC), PFFFT (BSD).
