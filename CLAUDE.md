# Proyecto: monitores KH 120 A + Sub8 + sala (contexto para continuar)

Idioma de trabajo: **español**. El usuario produce hardcore/gabber, escucha alto, y prefiere herramientas propias a Equalizer APO.

## Equipo y sala del usuario
- **Monitores:** 2 × Neumann KH 120 A sobre el escritorio, a ~1,5 m de la pared trasera y ~2 m de cada lateral; distancia de escucha ~1,2 m a la altura de los oídos.
- **Altura del oído medida: 1,10 m** (el dibujo del v0.05 la tiene a 1,22 m). Quiere los KH a esa altura y sin inclinar (el timbre no debe cambiar al moverse con la silla).
- **Sub:** ADAM Sub8 en el suelo, bajo el KH izquierdo.
  - Tiene filtro de satélites de 85 Hz conmutable y mando IR (corte y volumen).
  - El usuario cambia a mano el filtro y la fase (0/180°).
  - Su respuesta en Acustica3D está estimada (4.º orden a 28 Hz + LR4).
- **Audio:** Windows, Bitwig (ASIO), Focusrite Scarlett 2i2 2nd Gen (+10 dBu máx.; "Output level" recomendado de 108 dB).
- **Sala:** de ladrillo, con falso techo y trasdosado de pladur con lana de roca. Falta el `.dae` real exportado de SketchUp Pro 2023.
- **Micrófono:** el de Sonarworks está perdido; las medidas con REW quedan pendientes.

## Carpetas
- `fase1_datos_KH120A.md`, `LEEME_KH120A_DSP.md`, `src/*.py`: modelo del KH 120 A (Thiele-Small calibrado, difracción, no linealidad H2/H3) y diseño de FIR (fase lineal de 8192 tomas, baja latencia, LIN50/EXT40).
- `filtros/*.wav`: FIR provisionales a 44,1/48/88,2/96 kHz.
- `plugin/`: **KH120A Corrector** VST3/CLAP.
  - DPF + PFFFT, compilado con MinGW; pasa el validador VST3 47/47.
  - En Bitwig hace falta el .vst3 de un solo archivo (v0.1.1).
- `acustica3d/`: **Acustica3D**, simulación acústica 3D de la sala.
  - SvelteKit 3 · Svelte 5 · TS · Tailwind 4 · Three.js.
  - FDTD de graves en el navegador, en CPU o WebGPU.
  - El `README.md` describe el uso y la física.
  - Lanzador de Windows `launcher/Acustica3D.exe`: servidor C en 127.0.0.1 y Edge en modo app.
  - Icono en `launcher/acustica3d.ico` (enlazado con `acustica3d.rc`); `taskbar_thread` pone a la ventana de Edge el AppUserModelID `NapalmCandy.Acustica3D` y los datos de relanzado, para que al fijarla a la barra de tareas abra el .exe con su icono.

## Acustica3D: puntos clave
- **Desarrollo:**
  - `npm install` (`.npmrc` con legacy-peer-deps), `npm run dev`, `npx vitest run` (53 pruebas; `sim/ultra.spec.ts` tarda ~30 s), `npm run build`.
  - Prueba completa: `node testdata/e2e.mjs http://localhost:4173/ cpu|gpu`, con `vite preview` en marcha. Reinicia preview tras cada build.
  - No uses `pkill -f` con un patrón que aparezca en la misma orden.
- **Simulación:**
  - Progresiva por niveles: 100/160/250/350 Hz + fmax.
  - Se relanza sola al cambiar algo; mover el oyente en horizontal no la relanza.
- **Mejor posición** (`analysis/score.ts`):
  - Criterios: plano, huecos, picos, retumbe, robustez, simetría estéreo (paredes laterales + grave L/R), lejos de paredes y geometría.
  - Zona válida: ≥ 0,5 m de paredes, 0,7–2,5 m, apertura de 30–90°, centrado.
- **Colocación automática:** `sim/optimize.ts` + `doOptimize` en `sim/sim.worker.ts`. Usa la reciprocidad: una simulación por cada posición del oyente.
  - Qué posiciones del oyente se simulan: búsqueda bayesiana por defecto (`sim/bayes.ts`: proceso gaussiano + mejora esperada sobre candidatos cada 10 cm; presupuesto en `PRECISION` de `controller.ts`) o rejilla gruesa + afinado.
  - Si el worker se cae sin mensaje, `runOptimize(true)` reintenta una vez con el procesador.
  - **ULTRA** (Precisión «ULTRA», ≈ 1 h con GPU): KH cada 5 cm y 45–75°, sub cada 12,5 cm (puntuación gruesa y afinado alrededor de las 12 mejores parejas), bayesiana larga + todas las posiciones cerca de las 5 mejores, hasta 60 cambios de trampas, comprobación con ppw 14, ajustes en las 100 mejores y criterio `reflexiones` (medios y agudos de las 30 finalistas con `findPaths`; `earlyReflectionBad` en `sim.worker.ts`). Botón «Parar y quedarme con lo mejor» (`stopOptimize` → mensaje `opt-stop`).
  - Con tratamiento (`sim/treatment.ts`): paneles a las primeras reflexiones; trampas a huecos (esquinas y aristas, solo giros de la pieza dibujada) con valor marginal (añadir/quitar) y 8 cambios comprobados; luego otra búsqueda bayesiana corta.
- **Importar .skp** (`geometry/scene.ts`): reconoce KH, persona+silla, pantalla, trampas/paneles de lana (objetos con `mesh` exacta, `rotX`) y capas de paredes/techo (material de la superficie según lo de detrás). Densidad de lana del nombre o de `POROUS_PRODUCTS`.
- **Modelo del usuario:** `Estudio_v0.0x.skp` (4,12 × 6,66 × 2,67 m; 10 trampas de esquina y 3 paneles de lana de 80 kg/m³; paredes del fondo con lana Sonorock Eco de 30 kg/m³, laterales con cámara vacía; falso techo con plénum de 36 cm). No se sube al repositorio. Mesa provisional: la quiere poder quitar/poner («cuenta»); más adelante, simulación hasta 20 kHz para diseñarla.
  - Después ajusta el Sub8 (corte, nivel, fase, filtro de 85 Hz) y los interruptores Bass/Low-Mid de los KH en las 40 mejores colocaciones, probando todas las combinaciones (`tuneSettings`).
- **Interruptores del KH 120 A:** `KH_EQ` en `acoustics/speakers.ts`, ajustados a la gráfica del manual de Neumann (pág. 25): Bass, estante de 183 Hz y Q 0,62; Low-Mid, campana de 260 Hz y Q 0,36; Treble, estante de 5,4 kHz y Q 0,84.
- **Mapa de la sala:** de 20 a 300 Hz, con animación precalculada (`mapAnim.svelte.ts`, `doFrames`).
- **Medios y agudos** (pestaña `agudos`, `hf/imageSource.ts` en `hf/hf.worker.ts`): método de la imagen hasta orden 1–4 con oclusión y **difracción por zonas de Fresnel** (`hf/fresnel.ts`: integral de Fresnel–Kirchhoff sobre la parte libre/cubierta de la zona de Fresnel de cada tramo y rebote, muestreada con rayos en una BVH; caminos solo por difracción hasta orden 2; lado de cada cara que da al aire por paridad respecto al oído), directividad del KH 120 medida por Neumann (`hf/kh120Directivity.ts`, leída del manual con `scripts/kh120_directividad.py`; detrás de ±90° estimada), aire y absorción por octavas + cola difusa (Eyring, Q integrado). Reflectograma y zona libre de reflexiones. Pendiente: difusión, dos oídos (HRTF), unir con los graves (cruce ~300–500 Hz).
- **Mesas acústicas** en `mesa/` (raíz del repo; `node mesa/gen_mesas.mjs` genera los `.dae`; `README.md` con medidas y resultados):
  - *Con lana*: tablero 185 × 88 cm a 73 cm, franja de lana 80 kg/m³ de 5 cm × 30 cm a 23 cm del borde, KH en pies de suelo (bandeja a 95 cm). Desviación (300 Hz–4 kHz, 1/6 oct, media de 6 posiciones de cabeza) 2,75 → 1,11 dB.
  - *Sin lana* (pedida para teclado + teclado MIDI + torre): franja de 185 × 32 cm con el borde a Y 4,50, inclinada 10° (sube hacia los KH: su rebote va al pecho), bandeja MIDI extraíble de 105 × 30 cm a 60 cm, torre en el suelo a la izquierda, nada detrás (pantalla en brazo VESA). 1,22 dB. Un tablero detrás sin lana devuelve el rebote (3,0 dB).
  - *Tres cuerpos mejorada* (la idea del usuario: cuerpos con ruedas que se meten uno dentro de otro, KH sobre la mesa por seguridad con niñas y gatos, sin brazo VESA, DM pintado): alto 185 × 40 cm a 95 cm con el frontal del KH al ras (Y 5,55–5,95), medio 105 × 38 cm a 74 cm para la pantalla (Y 5,40–5,78), bajo 96 × 28 cm a 62 cm para teclado y ratón (Y 4,45–4,73). 2,73 → 1,29 dB. Su diseño original fallaba por difracción en los bordes (la prueba del espejo de SketchUp es óptica de rayos).
  - *Mesa útil* (en marcha, `Mesa_util.dae`): instrumentos a mano (balda a 75 cm, Y 4,65–5,05) con **ventana de lana a ras** donde rebota el sonido (idea del usuario; 1,60 dB vacía, 1,59 con un teclado encima; sin mesa 1,78), bandeja de teclado a 66 cm debajo (7 cm de hueco), KH a 1,10 m sobre tablero a 0,94, pantalla detrás entre los KH. Probado y descartado: DM taladrado (refleja por encima de 1 kHz), difusores (no actúan en 0,5–2 kHz con poca profundidad), balda inclinada, bajar los KH. Lo estético va después.
  - **Mapa de zonas sensibles** (`Mapa_zonas_sensibles.png`, `Mapa_tres_cuerpos.png`): nivel que manda al oído un borde en cada punto (zonas de Fresnel + |F(v)| de un borde + directividad del KH), alzado y plantas. Generado con scripts de la sesión; idea: llevarlo a la app.
  - La lana dentro de un grupo «mesa» se queda fija (`scene.ts`); «plástico/teclado» → plástico duro, «metal» → metal.
- **Lanzador:** Edge con `--force_high_performance_gpu` (el usuario tiene una RTX 3080 y Edge cogía la integrada).
- **Artifact web** (privado): https://claude.ai/artifact/V2mNhwfGzLEqnW9TUmchmo.
  - Se genera con `node scripts_artifact.mjs`; usa `appDir: 'app'` porque el servicio no admite rutas con `_`.

## Repositorio y versiones
- Repositorio **público** `NapalmCandy/Acustica3D`, rama `main`. El plugin usa los submódulos `plugin/dpf` y `plugin/pffft`.
- **Versiones:** al cambiar `version` en `acustica3d/package.json` en `main` (o a mano con *Run workflow*), `.github/workflows/release.yml` publica la release `vX.Y.Z` con `Acustica3D_win64.zip` y `Acustica3D_win64.pack`. Esa versión se pasa a `-DAPP_VERSION`.
- **Commits:** el autor es el usuario (`NapalmCandy <12048931+NapalmCandy@users.noreply.github.com>`), sin coautoría de Claude.
- **Etiquetas:** desde las sesiones en la nube no se pueden subir etiquetas (403 del proxy); por eso las releases las crea el flujo.
- **Actualizador** de `launcher/acustica3d.c`:
  - Consulta `releases/latest` (WinHTTP) al arrancar, cada 6 h y al volver a la ventana (`POST /api/update/check`, una vez cada 5 min como mucho), y descarga el `.pack` a `actualizacion\`.
  - Lo instala al cerrar, renombrando el `.exe` en marcha a `.old`.
  - La app lo muestra con `GET /api/update` y reinicia con `POST /api/update/restart` (comprueba `Origin`).
  - Formato del `.pack`: `scripts/package.mjs`.
  - Se puede probar con `ACUSTICA3D_UPDATE_URL` y Wine.

## Pendiente / ideas
- Medios y agudos: unir con los graves en una sola curva, trazado de rayos para la cola, dos oídos; diseñar la mesa nueva con ello.
- Fase 2: reflexiones tempranas, puntos de primera reflexión y paneles.
- Varios subs.
- Calibración con medidas de REW.
- Exportar filtros al plugin.
- Corrección a nivel de sistema en Windows (tipo Sonarworks).
