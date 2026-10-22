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
x86_64-w64-mingw32-windres launcher/acustica3d.rc -O coff -o launcher/acustica3d.res   # icono
x86_64-w64-mingw32-gcc -O2 -mwindows -static -DAPP_VERSION='"0.3.0"' -o launcher/Acustica3D.exe launcher/acustica3d.c launcher/acustica3d.res -lws2_32 -lshell32 -ladvapi32 -lwinhttp -lole32
node scripts/package.mjs 0.3.0   # dist/Acustica3D_win64.zip y .pack
```


## Importador de .skp

`src/lib/geometry/skp.ts` lee los `.skp` de SketchUp 2021 y posteriores sin el SDK de SketchUp. El formato está documentado al principio del archivo:
- un ZIP con `model.dat`;
- un árbol de bloques etiqueta + longitud;
- vértices, aristas, caras con bucles e instancias con su matriz por filas.

La prueba sintética (`skp.spec.ts`) construye un `.skp` mínimo. Con `SKP_FILE=ruta.skp npx vitest run` también se prueba un archivo real. Los archivos reales de otras personas no se suben al repositorio.

## Versiones y actualizaciones

- Al cambiar `version` en `package.json` en `main`, `.github/workflows/release.yml` publica la release `vX.Y.Z` con `Acustica3D_win64.zip` y `Acustica3D_win64.pack`. También se puede lanzar a mano con *Run workflow*.
- **Actualizador de `Acustica3D.exe`:**
  - Consulta `releases/latest` al arrancar, cada 6 h y al volver a la ventana (`POST /api/update/check`, como mucho una vez cada 5 min).
  - Descarga el `.pack` a `actualizacion\` y lo instala al cerrar (o con `POST /api/update/restart`).
  - La app muestra el estado con `GET /api/update`.
  - Para probarlo hay que apuntar `ACUSTICA3D_UPDATE_URL` a un servidor de pruebas.

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

`npx vitest run`, 30 pruebas. Las de física (más la de reciprocidad):
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

Las de la búsqueda bayesiana (`bayes.spec.ts`), con una puntuación sintética de varios máximos:
- el proceso gaussiano pasa por los puntos medidos y duda lejos de ellos;
- los puntos de partida se reparten por la sala;
- con 30 simulaciones llega a menos de 1 punto del máximo, mejor que una rejilla de 45 cm con más simulaciones;
- los sitios sin colocación posible no rompen la búsqueda.

Prueba de extremo a extremo en Chromium: `node testdata/e2e.mjs URL gpu|cpu`. Con `gpu` usa WebGPU emulada por software (SwiftShader) y comprueba que GPU y procesador dan el mismo mapa.


## Historial de cambios

### v0.7
- **Lo dibujado en el .skp se reconoce** (`geometry/scene.ts`, con los grupos que ahora devuelve `skp.ts`):
  - KH dibujados → se quitan de la geometría y sus posiciones (woofer: 18 cm bajo lo más alto) pasan a ser las de los KH; persona y silla → se quitan y la cabeza (ojos, 8 cm hacia atrás) es la posición de escucha; el sub va al suelo bajo el KH izquierdo; la pantalla del PC se quita.
  - Trampas y paneles de lana (grupos enteros de material poroso, de tamaño de mueble) → objetos movibles con **su forma exacta** (`RoomObject.mesh`, en ejes locales), su grosor, su cámara de aire (rayo hasta la superficie más cercana) y la densidad del nombre del material («80kg/m3») o de la ficha del producto (`POROUS_PRODUCTS`: Sonorock Eco 30 kg/m³, AFr5). En diagonal en una esquina → «Trampa de esquina»; si no, «Panel». Pueden ir girados en Y e inclinados en X (`rotX`).
  - Paredes y techos por capas: a la capa que da al aire se le pone el material según lo que tiene detrás: pladur + lana → trasdosado con lana; pladur + cámara vacía → `pladur_camara` (nuevo); pladur con capas encima → falso techo con plénum.
- **Casilla «cuenta» en cada material**: desmarcada, el material es acústicamente transparente (p. ej. la mesa provisional), y al marcarla vuelve el que tenía.
- **Colocación automática con tratamiento** (`sim/treatment.ts`, casilla «Mover también trampas y paneles»):
  - Los paneles planos van a los puntos de primera reflexión de los KH (paredes laterales, por el método de la imagen) y al techo entre las dos reflexiones; conservan su cámara de aire.
  - Huecos para las trampas: sus posturas actuales y la misma pieza girada (nunca reflejada) a las cuatro esquinas, a todas las alturas, y a lo largo de las aristas pared-techo y pared-suelo. Se descartan los que no caben en el aire de la sala vacía.
  - Con las dos mejores posiciones de escucha: cuánto aporta una trampa más en cada hueco libre y cuánto se pierde quitando cada una; se comprueban de verdad los 8 cambios más prometedores y se aceptan los que suben más de 0,3 puntos. Después, otra búsqueda bayesiana (la mitad) de la posición de escucha con el tratamiento nuevo.
  - «Aplicar» también mueve trampas y paneles (los paneles, a las reflexiones de la fila elegida).

### v0.6
- **Búsqueda bayesiana** en la colocación automática (`sim/bayes.ts`), ahora la opción por defecto. Un proceso gaussiano (núcleo de Matérn 5/2, hiperparámetros por verosimilitud marginal) estima la puntuación en todo el suelo a partir de las posiciones ya simuladas, y la siguiente se simula donde la mejora esperada es mayor. Empieza con unas posiciones repartidas por la sala (lejos de las paredes y entre sí). Simula `base + por m² de zona válida` posiciones según la precisión, en vez de la rejilla completa más su afinado. La rejilla sigue disponible.
- Si el worker de la búsqueda se cae sin dar motivo, se reintenta una vez con el procesador y, si vuelve a fallar, se explica qué probar (antes solo decía «Error en la búsqueda»). Con el sub limitado a cerca de los KH, solo se simulan los sitios del sub a su alcance.
- **Barra de tareas:** `Acustica3D.exe` lleva icono y le da a la ventana de Edge un AppUserModelID propio y los datos para volver a abrirla (este .exe, su nombre y su icono). Al fijarla a la barra de tareas, el acceso directo abre Acustica3D.exe con su icono, no Edge.

### v0.5
- La colocación automática también ajusta el Sub8 (corte, nivel, fase y filtro de 85 Hz de los satélites) y los interruptores Bass y Low-Mid de los KH. Lo hace en dos etapas: primero la colocación y después los ajustes de las 40 mejores, probando todas las combinaciones (son pocas y no hace falta simular).
- Prueba más colocaciones: distancias cada 10 cm y aperturas de 50°, 60° y 70°.
- Fila «tú*»: tu colocación actual solo cambiando los ajustes.
- Interruptores Bass, Low-Mid y Treble de los KH 120 A en la barra lateral, modelados a partir de la gráfica del manual de Neumann (pág. 25). Se desactivan con `KH_EQ.enabled` en `speakers.ts`.

### v0.4.1
- Busca actualizaciones también al volver a la ventana (como mucho una vez cada 5 minutos).

### v0.4
- Abre los `.skp` de SketchUp directamente (2021 o posterior), sin exportar a `.dae`. Respeta lo oculto y las etiquetas ocultas, los materiales con su color, y los componentes y grupos con sus transformaciones.

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

