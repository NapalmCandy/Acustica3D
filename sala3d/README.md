# Sala3D — simulación acústica 3D de la sala

Aplicación web (SvelteKit 3 · Svelte 5 · TypeScript · Tailwind CSS 4 · Three.js) para importar el modelo de la sala desde SketchUp, asignar materiales acústicos, colocar los KH 120 A, el Sub8 y la posición de escucha, y simular el comportamiento de los graves en 3D.

**Fase 1: graves con simulación de ondas.** Todo se calcula en tu PC, en el procesador o en la tarjeta gráfica (WebGPU).

**Novedades de la v0.3**
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

**Novedades de la v0.2**
- **Mapa de la mejor posición de escucha:** puntúa cada punto posible a la altura de tus oídos, con los altavoces donde están. Los criterios tienen pesos ajustables:
  - grave plano, sin huecos, sin picos, poco retumbe;
  - robustez al mover la cabeza, simetría L/R y geometría.
- **Pseudo-directo progresivo:** primero sale una vista previa gruesa (hasta 100 Hz, en ~1 s) y se va afinando por niveles hasta la frecuencia máxima. Si mueves un altavoz, el sub, un objeto o un material, se recalcula solo.
- **Respuesta en directo del punto de escucha:** al arrastrar al oyente (en el mapa o en 3D) la curva cambia al instante, sin volver a simular. Se compara con el mejor punto y con el punto bajo el ratón.
- **Qué cuenta:** el rango de frecuencias que puntúa (por defecto 40–200 Hz) y la distancia de escucha (0,7–2,5 m). Hay preajustes: Hardcore 40–200, 30–200, 20–250 y solo sub.
- **Objetos y paneles:** paneles de lana de roca, trampas de graves, muebles y sofá, que se añaden y se mueven en 3D.
- **GPU (WebGPU):** el modo automático usa la tarjeta gráfica solo si es real y la rejilla es grande (≥ 120 000 celdas); en salas pequeñas o a baja resolución, el procesador es más rápido. También se puede *Forzar GPU* o elegir *Solo procesador*.

## Cómo abrirlo

Hay tres maneras. Para usarlo, la primera o la segunda.

**1. Programa para Windows: doble clic, en su propia ventana (recomendado)**
Descarga `Sala3D_win64_v0.3.zip` y sigue estos pasos:
1. Descomprímelo entero (clic derecho > *Extraer todo*).
2. Abre `Sala3D.exe`.
3. Se abre en una ventana propia, sin pestañas ni barra de direcciones (Edge en modo aplicación).
4. Al cerrar la ventana, el programa termina.

Más detalles en el `LEEME.txt` del paquete.

**2. En el navegador, sin descargar nada**
Abre el enlace privado de la app publicada (el que te pasé en la conversación) en Chrome o Edge.

**3. Desde este código fuente (para desarrollar)**
Este zip es el código, no el programa ya hecho:
1. Instala Node.js 22 LTS desde https://nodejs.org.
2. Abre una terminal en esta carpeta.
3. Ejecuta `npm install` y después `npm run dev`.
4. Abre http://localhost:5173.

## Uso

1. En SketchUp Pro, dale a cada superficie importante un material con nombre claro, por ejemplo:
   - `Pladur`, `Falso_techo`, `Suelo_tarima`, `Ventana`, `Puerta`, `Escritorio`;
   - para los paneles, algo como `Panel_LR_50mm`.
2. Exporta desde *Archivo › Exportar › Modelo 3D › COLLADA (.dae)*:
   - marca *Triangular todas las caras* y *Exportar caras de dos lados*;
   - desmarca aristas y texturas.
3. Carga el `.dae` en la app (también acepta `.obj` y `.glb`) y revisa la asignación automática de materiales.
4. Coloca los equipos con coordenadas o arrastrándolos en 3D. La simulación arranca sola (o con **Simular ahora**).
   Añade paneles, trampas u otros objetos en *4 · Objetos y paneles*.
5. Revisa los resultados:
   - **Mejor posición:** mapa de calor (oscuro = mejor) con el mejor punto y tu posición. Haz clic o arrastra sobre el mapa para mover al oyente y ver su curva al momento. *Mover el oyente al mejor punto* lo coloca ahí.
   - **Respuesta:** curva en tu sitio, la variación en la zona de escucha y los picos (recortables con DSP) frente a los huecos (que no lo son).
   - **Decaimiento:** cascada y tiempos EDT/T20/T30 por tercios de octava.
   - **Mapa de la sala:** nivel a la altura de tus oídos, también superpuesto en 3D.
   - **Superficies y reverberación:** áreas reales por material y tiempo de reverberación estadístico (Eyring) en todas las octavas.

Las coordenadas se muestran como en SketchUp: X ancho, Y fondo, Z altura.

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

### Limitaciones

- **Simulación de graves:** solo hasta la frecuencia máxima elegida (150–500 Hz). El mapa de posición usa como mucho el 80 % de esa frecuencia, hasta 250 Hz.
- **Mapa de posición:** sirve para comparar sitios, no como valor absoluto. Solo tiene en cuenta graves y geometría; las reflexiones de medios y agudos llegan en la fase 2.
- **Velocidad con GPU:** solo se ha probado con WebGPU emulada. La velocidad con una tarjeta real está por comprobar en tu PC; el motor que se usa se indica en *5 · Simulación*.
- **Absorción en graves:** independiente de la frecuencia (un valor por material).
- **Superficies inclinadas:** su área se cuenta "en escalera".
- **Medios y agudos:** solo el tiempo de reverberación estadístico por ahora. Reflexiones tempranas y puntos para los paneles, en la fase 2.
- **Valores de materiales:** típicos. Con medidas de REW se calibrarán (fase 4).

## Desarrollo

```bash
npm install          # .npmrc activa legacy-peer-deps (necesario con vitest + vite 8)
npm run dev          # http://localhost:5173
npx vitest run       # pruebas de física
npm run build        # versión estática en build/
```

**Programa de Windows** (`launcher/`): `Sala3D.exe` es un servidor local mínimo en C, que solo escucha en 127.0.0.1. Abre la app en una ventana de Edge en modo aplicación, con un perfil propio, y se cierra al cerrar esa ventana. Para compilarlo desde Linux:

```bash
npm run build
x86_64-w64-mingw32-gcc -O2 -mwindows -static -o launcher/Sala3D.exe launcher/sala3d_server.c -lws2_32 -lshell32 -ladvapi32
# paquete: Sala3D.exe + carpeta web/ con el contenido de build/
```

## Próximas fases

2. Reflexiones tempranas (fuentes imagen), ETC, zona libre de reflexiones, puntos de primera reflexión → posición de los paneles.
3. Optimizador de posiciones (oyente, KH, sub) con varios criterios y reciprocidad.
4. Calibración con medidas de REW, escritorio y exportación de filtros al plugin KH120A Corrector.
