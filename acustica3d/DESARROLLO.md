# Acustica3D — notas de desarrollo

Aplicación web (SvelteKit 3 · Svelte 5 · TypeScript · Tailwind CSS 4 · Three.js) con un lanzador de Windows en C (`launcher/`).

## Compilar y probar

```bash
npm install          # .npmrc activa legacy-peer-deps (necesario con vitest + vite 8)
npm run dev          # http://localhost:5173
npx vitest run       # pruebas de física
npm run build        # versión estática en build/
```

**Programa de Windows** (`launcher/`): `Acustica3D.exe` es un servidor local mínimo en C, que solo escucha en 127.0.0.1. Abre la app en una ventana de Edge en modo aplicación, con un perfil propio, y se cierra al cerrar esa ventana. Para compilarlo desde Linux:

```bash
npm run build
x86_64-w64-mingw32-gcc -O2 -mwindows -static -DAPP_VERSION='"0.3.0"' -o launcher/Acustica3D.exe launcher/acustica3d.c -lws2_32 -lshell32 -ladvapi32 -lwinhttp
node scripts/package.mjs 0.3.0   # dist/Acustica3D_win64.zip y .pack
```


## Versiones y actualizaciones

- Al cambiar `version` en `package.json` en `main`, `.github/workflows/release.yml` publica la release `vX.Y.Z` con `Acustica3D_win64.zip` y `Acustica3D_win64.pack`. También se puede lanzar a mano con *Run workflow*.
- **Actualizador de `Acustica3D.exe`:**
  - Consulta `releases/latest` al arrancar y cada 6 h.
  - Descarga el `.pack` a `actualizacion\` y lo instala al cerrar (o con `POST /api/update/restart`).
  - La app muestra el estado con `GET /api/update`.
  - Para probarlo hay que apuntar `SALA3D_UPDATE_URL` a un servidor de pruebas.

## Física

| Parte | Método |
|---|---|
| **Graves** | FDTD 3D, esquema rectilíneo estándar con λ = 1/√3. Contornos de reacción local con admitancia por material, en formulación de volúmenes finitos (Kowalczyk & van Walstijn, 2011). Fuente puntual de banda limitada. Normalización absoluta: 0 dB = campo libre a 1 m. |
| **Geometría** | Discretización de triángulos con engrosado y refinado posterior: el borde del aire queda centrado en la superficie real. Detección de fugas: avisa si la sala no está cerrada. |
| **Materiales** | Coeficientes típicos por octavas. Paneles de lana de roca calculados con el modelo de Miki (grosor, densidad, cámara de aire) y la integral de Paris. Conversión a admitancia equivalente para los graves. |
| **KH 120 A** | Modelo calibrado de la Fase 2 (Thiele-Small, reflex y electrónica). |
| **Sub8** | Estimado: 4.º orden a 28 Hz y cruce LR4. Se afinará midiendo. |
| **Combinación** | Las respuestas de altavoz y cruce se combinan en frecuencia. El cruce, el nivel, la fase y el retardo del sub se cambian sin volver a simular. |

### Validación

`npx vitest run`, 17 pruebas. Las de física (más la de reciprocidad):
- **Campo libre:** 0 dB ± 1 dB a 1 m.
- **Sala rígida:** modos a menos del 2,5 % de c/2L.
- **Inversión α↔β** coherente.
- **Panel poroso:** tendencias correctas.
- **KH 120 A:** −3 dB a 52 Hz.
- **Sala de ejemplo:** cerrada, con el volumen correcto y la absorción acortando el decaimiento, coherente con Sabine.

Las del mapa de posición:
- un hueco penaliza;
- el rango de frecuencias decide qué cuenta;
- se excluyen las paredes y los sitios entre, detrás, pegados o al lado de los altavoces;
- estar centrado y lejos de las paredes puntúa mejor que pegado a una;
- la geometría centra el punto;
- las cajas de los objetos giradas son correctas.

Prueba de extremo a extremo en Chromium: `node testdata/e2e.mjs URL gpu|cpu`. Con `gpu` usa WebGPU emulada por software (SwiftShader) y comprueba que GPU y procesador dan el mismo mapa.


## Historial de cambios

### v0.3
- **Colocación automática** (pestaña propia): coloca el oyente, los dos KH y el sub, prueba combinaciones por toda la sala y propone las 5 mejores con su puntuación frente a tu colocación actual. *Aplicar* mueve los equipos y vuelve a simular.
  - Para cada posición de la cabeza prueba los KH en triángulo equilátero (0,8–2 m), mirando hacia cada pared o solo con tu orientación actual.
  - Para el sub prueba cada punto del suelo, también los rincones, con su fase a 0° y a 180°.
  - Primero recorre la sala con una rejilla gruesa y después afina alrededor de los 3 mejores sitios.
  - Usa la **reciprocidad**: una simulación con la fuente en la cabeza da la respuesta de todas las posiciones posibles de los altavoces a la vez. Está comprobada con una prueba (A→B = B→A, diferencia < −60 dB).
- **Criterios de escucha revisados**:
  - **Lejos de paredes** (nuevo): pared de detrás a ≥ 1,2 m y laterales a ≥ 1 m. Por debajo de 0,5 m el sitio no es válido.
  - **Simetría estéreo**: las paredes laterales a la misma distancia de la cabeza según el eje de escucha, además del mismo grave por canal.
  - **Zona válida**: posiciones con 30–90° de apertura a los KH y centradas (|dL − dR| ≤ 0,35 m).
  - **Pesos por defecto**: grave plano 1; huecos 1,5; picos 0,5; retumbe 1; robustez 0,8; simetría 1,5; paredes 1,5; geometría 1.
- **Mapa de mejor posición en rojo → blanco → verde**, relativo a la sala (verde = mejor). Tu posición se marca en morado.
- **Mapa de la sala de 20 a 300 Hz con Play**: el barrido completo (1/48 de octava) se precalcula en segundo plano al terminar la simulación, así que la animación va fluida. Tiene velocidad y bucle. La frecuencia máxima por defecto pasa a 350 Hz para llegar a 300 Hz.
- **Respuesta**: nueva curva *Solo sub (con su cruce)*.
- La vista 3D solo se redibuja cuando algo cambia (menos consumo).

### v0.2
- **Mapa de la mejor posición de escucha:** puntúa cada punto posible a la altura de tus oídos, con los altavoces donde están. Los criterios tienen pesos ajustables:
  - grave plano, sin huecos, sin picos, poco retumbe;
  - robustez al mover la cabeza, simetría L/R y geometría.
- **Pseudo-directo progresivo:** primero sale una vista previa gruesa (hasta 100 Hz, en ~1 s) y se va afinando por niveles hasta la frecuencia máxima. Si mueves un altavoz, el sub, un objeto o un material, se recalcula solo.
- **Respuesta en directo del punto de escucha:** al arrastrar al oyente (en el mapa o en 3D) la curva cambia al instante, sin volver a simular. Se compara con el mejor punto y con el punto bajo el ratón.
- **Qué cuenta:** el rango de frecuencias que puntúa (por defecto 40–200 Hz) y la distancia de escucha (0,7–2,5 m). Hay preajustes: Hardcore 40–200, 30–200, 20–250 y solo sub.
- **Objetos y paneles:** paneles de lana de roca, trampas de graves, muebles y sofá, que se añaden y se mueven en 3D.
- **GPU (WebGPU):** el modo automático usa la tarjeta gráfica solo si es real y la rejilla es grande (≥ 120 000 celdas); en salas pequeñas o a baja resolución, el procesador es más rápido. También se puede *Forzar GPU* o elegir *Solo procesador*.

