# Proyecto: monitores KH 120 A + Sub8 + sala (contexto para continuar)

Idioma de trabajo: **español**. El usuario produce hardcore/gabber, escucha alto, y prefiere herramientas propias a Equalizer APO.

## Equipo y sala del usuario
- **Monitores:** 2 × Neumann KH 120 A sobre el escritorio, a ~1,5 m de la pared trasera y ~2 m de cada lateral; distancia de escucha ~1,2 m a la altura de los oídos.
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

## Acustica3D: puntos clave
- **Desarrollo:**
  - `npm install` (`.npmrc` con legacy-peer-deps), `npm run dev`, `npx vitest run` (25 pruebas), `npm run build`.
  - Prueba completa: `node testdata/e2e.mjs http://localhost:4173/ cpu|gpu`, con `vite preview` en marcha. Reinicia preview tras cada build.
  - No uses `pkill -f` con un patrón que aparezca en la misma orden.
- **Simulación:**
  - Progresiva por niveles: 100/160/250/350 Hz + fmax.
  - Se relanza sola al cambiar algo; mover el oyente en horizontal no la relanza.
- **Mejor posición** (`analysis/score.ts`):
  - Criterios: plano, huecos, picos, retumbe, robustez, simetría estéreo (paredes laterales + grave L/R), lejos de paredes y geometría.
  - Zona válida: ≥ 0,5 m de paredes, 0,7–2,5 m, apertura de 30–90°, centrado.
- **Colocación automática:** `sim/optimize.ts` + `doOptimize` en `sim/sim.worker.ts`. Usa la reciprocidad: una simulación por cada posición del oyente.
  - Después ajusta el Sub8 (corte, nivel, fase, filtro de 85 Hz) y los interruptores Bass/Low-Mid de los KH en las 40 mejores colocaciones, probando todas las combinaciones (`tuneSettings`).
- **Interruptores del KH 120 A:** `KH_EQ` en `acoustics/speakers.ts`, ajustados a la gráfica del manual de Neumann (pág. 25): Bass, estante de 183 Hz y Q 0,62; Low-Mid, campana de 260 Hz y Q 0,36; Treble, estante de 5,4 kHz y Q 0,84.
- **Mapa de la sala:** de 20 a 300 Hz, con animación precalculada (`mapAnim.svelte.ts`, `doFrames`).
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
- Usar el `.dae` real del usuario.
- Fase 2: reflexiones tempranas, puntos de primera reflexión y paneles.
- Varios subs.
- Calibración con medidas de REW.
- Exportar filtros al plugin.
- Corrección a nivel de sistema en Windows (tipo Sonarworks).
