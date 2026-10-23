# Traspaso: mesa «Arco», triángulo de 60° y corrección del motor de agudos (sesión del 23-10-2026)

Estado del trabajo para que otra sesión pueda seguirlo. Los scripts están en `mesa/banco/` (ver `mesa/banco/LEEME.md`). Idioma: español. Commits como el usuario (ver `CLAUDE.md`).

## Qué pidió el usuario (en orden)

1. La mesa útil con diseño (`Mesa_util_diseno.dae`) mejora hasta unos 3 kHz frente a no tener mesa, pero **empeora de 3 a 20 kHz**. Quiere **mejorar ese tramo sin perder lo ganado**.
   - Idea suya: que la mesa haga de «guía», como una mejora de la propia caja.
2. **No solo la respuesta plana:** también fase, filtro en peine, simetría y zona libre de reflexiones, como en la app.
3. **Restricciones del suelo:**
   - nada de lana en el suelo; como mucho una moqueta bajo la mesa;
   - la **Roomba** debe pasar por debajo, con **15 cm libres**;
   - nada debe molestar a las piernas.
4. **Pantalla:** con su pie, en un **recorte curvo** del tablero de los KH, más baja que ellos, como en su mesa de SketchUp. Le parece bien quitar el pie y usar VESA, e incluso un elevador motorizado oculto, pero prefiere lo simple.
5. **Estética:** le gustan las tiras LED ocultas y las líneas paralelas y diagonales. La quiere todavía más moderna, elegante y de aspecto premium y caro.
6. **Manual del KH 120:** triángulo, distancias y posición en la sala.
   - Lo subió en `/root/.claude/uploads/.../f71910f3-neumann-kh_120-enceinte-manuel.pdf`; ya no existirá en otra sesión.
   - Regla: **el manual como guía, pero sobre todo los resultados del análisis**.
   - La mesa **se puede mover**: su distancia a la pared no es fija.
7. **Sub:** que se tenga en cuenta, o se ponga en otro sitio.

## Lo que dice el manual (página 10)

- **Estéreo:** ±30° (60°), los dos KH a la misma distancia del oído (±1 cm).
- **Distancia de escucha:** recomendada 1,0–2,0 m (mínimo 0,75 m, máximo 4 m).
- **Pared de detrás de los KH:** evitar 0,8–2 m. Con gestión de graves (sub + filtro de 85 Hz) basta con evitar 0,8–1 m. Lo mismo para paredes laterales y techo.
- **Eje acústico:**
  - está en el punto medio entre woofer y tweeter, a **17,0 cm de la base** (x = 9,1 cm);
  - es una recta **perpendicular al frontal** y debe apuntar al oído en horizontal y en vertical.
- **Low-Mid sobre una mesa:** −1,5 dB con una pequeña, −3 dB con una grande. Bass: −2,5 / −5 / −7,5 dB según la pared.
- **Pies adhesivos** debajo del KH.
- Disponer todo de forma simétrica y reducir lo que vuelve al oído con superficies inclinadas o tratamiento.

## Hecho

### 1. El modelo del KH sobre una mesa tenía un error (banco)

- **El problema:** la app pone la fuente en el centro de la caja, 11,5 cm detrás del frontal, y la caja no es un obstáculo.
  - Por eso el tablero bajo el KH hacía de espejo: rebote a 0,09 ms y −14 dB, el valle de 5–6 kHz de la mesa útil.
- **En el banco:**
  - fuente a 4 mm delante del frontal;
  - caja de 18,2 × 27,7 × 23 cm, con el frontal y la base absorbentes, que tapa lo que tiene debajo.
- **Con el modelo corregido**, la mesa útil apenas mejoraba por debajo de 3 kHz: 1,84 dB, frente a 1,89 sin mesa.
- **Pendiente en la app:** `geometry/scene.ts` (`acoustic()`) sigue poniendo la fuente en el centro de la caja. Habría que ponerla en el frontal, en la cara que mira al oyente, y para medios y agudos tratar la caja como obstáculo.

### 2. Error del motor de agudos: tiras finas lejos del punto de rebote (corregido en `acustica3d/src/lib/hf/fresnel.ts`)

- **El fallo:** `apertureAmp` integraba el ángulo con 8 pasos fijos por sector. Lejos del centro, la fase de un borde gira más de media vuelta entre pasos y no se cancela.
  - Una tira de 2 cm a 60 cm del punto de rebote daba −20 dB.
  - La óptica física da −50 dB (`mesa/banco/optica_fisica/po_tiras.mjs`, `po_lateral.mjs`).
  - Inflaba los «rebotes por difracción» de cantos, laterales y caras escondidas en todas las mesas.
- **La corrección:**
  - cada término de borde se pondera con sinc(Δφ/2), con Δφ el giro de su fase en el paso;
  - más allá de ~3,5 radios de Fresnel se atenúa con exp(−(ρ/3,5r)⁴): las paredes son espejos y ya van por las imágenes.
- **Pruebas:** `src/lib/hf` pasa. Hay una prueba nueva en `fresnel.spec.ts`: tablero mediano frente a óptica física (±2,5 dB) y tira lejana por debajo de −30 dB.
  - Ojo: la prueba de la tira **también pasaba sin la corrección**. Conviene endurecerla para que falle con el código antiguo; probablemente ahí no encuentra el camino.
- **Pendiente:**
  - pasar la suite completa (`npx vitest run`) y la prueba completa (`node testdata/e2e.mjs ... cpu`);
  - apuntarlo en `DESARROLLO.md`;
  - subir la versión (0.10.3) para publicar la release.

### 3. Triángulo en la sala (graves; `mesa/banco/graves/triangulo.spec.ts`)

- **Cómo:** el worker de la colocación automática en Node, con la sala v0.05 sin mesa.
  - Apertura fija de 60°, distancias de 1,0 a 2,0 m, KH y oído a 1,10 m.
  - El sub libre, con sus ajustes; Bass y Low-Mid incluidos.
  - Resultados en `mesa/banco/resultados/graves_triangulo_*.json`.
- **La puntuación de graves es casi plana:** 76–80 en todos los tamaños, y entre ejecuciones varía 1–2 puntos. La colocación actual del dibujo saca 55.
- **Una zona que se repite en todos los tamaños:** oyente en Y ≈ 4,1–4,5 m y trasera de los KH a 1,0–1,4 m de la pared frontal.
  - Hoy está a 0,87 m, dentro de la franja de 0,8–1 m que el manual pide evitar.
- **Elegido (por medios y agudos y por comodidad, ver 4):**
  - oyente en (x 2,05, Y 4,19) a 1,10 m;
  - **D = 1,40 m**: frontal de los KH en Y 5,40, a ±30°, girados hacia el oído;
  - trasera de los KH a 1,02 m de la pared, 1,36 m a los laterales, 1,57 m al techo.
- **Sub8, según el análisis con D = 1,4:**
  - en el suelo en (2,85, Y 5,14);
  - corte a 70 Hz, +2 dB, fase normal;
  - **filtro de 85 Hz activado** en los KH, Bass −7,5 dB y Low-Mid −4,5 dB.
  - Con D = 1,2: sub en (3,35, 5,14), corte a 50 Hz, Bass −7,5 dB.

### 4. Banco de medios y agudos paramétrico (`mesa/banco/agudos/agudos.spec.ts` + `desk3.ts`)

- **Medidas:**
  - desviación en 0,3–3 kHz, 3–16 kHz y total;
  - fase en exceso (desviación en grados);
  - diferencia L/R;
  - peine: el rebote más fuerte en menos de 2 ms;
  - zona libre de reflexiones: el rebote más fuerte en 20 ms.
  - Todo como media de 6 posiciones de cabeza.
- **Configuración:** las variantes van en `VARS`, separadas por comas; **sin comas en los nombres**. El triángulo, en `TRI`. También aceptan `SUB` y `HALF`.
- **Lo que funciona:**
  - **balda en corona** (arco centrado en el oído) con la ventana centrada en el punto de rebote (radio D/2);
  - **aletas de contrachapado de 3 mm cada 4 cm** sobre lana de 3 cm, forradas de tela;
  - **inclinada 8° hacia el oyente** (sube hacia los KH): su rebote va al pecho;
  - **los KH sobresalen 3 cm del canto del puente**.
  - Resultado con D = 1,37 y el oyente en Y 4,372 (laterales a ±1,08, banco antiguo): 0,3–3 kHz 0,86, 3–16 kHz 0,52, fase 5,2°, peine −26 dB, 20 ms −21 dB. Sin mesa: 1,60 / 0,47 / 8,4°.
- **Lo que no funciona:**
  - retícula sobre lana, balda de madera, frente de listones bajo el puente (en el canto o a 30 cm), frente de tela;
  - pantalla colgada en VESA: peor que con su pie en el rebaje.
  - La moqueta apenas cambia nada.
  - Un teclado MIDI encima de la ventana empeora los agudos (1,11 dB): es un objeto duro en la zona del rebote.
- **¡Ojo!** Todos esos números son **de antes de la corrección del motor (punto 2)**, y estaban inflados por los caminos de difracción falsos. **Hay que repetirlos con el motor corregido.**

### 5. Mesa «Arco» (`mesaArco` en `mesa/gen_mesas.mjs` → `Mesa_arco.dae`)

- **Paramétrica:** `ARCO = { xc 2,05, ye 4,19, ear 1,1, D 1,4, half 0,96, sub }`. Todo lo de delante es un arco centrado en el oído.
- **Piezas:**
  - laterales «en ala» de 38 mm: una banda de 12 cm que sigue el contorno, un poste detrás y una pata inclinada, con pies retranqueados (15 cm libres para la Roomba);
  - puente a 0,93 m (eje a 1,10 m), con el canto en arco, roble en el canto y pies adhesivos;
  - **rebaje curvo central** para la pantalla con su pie (fondo a 0,785 m: centro de la pantalla a 1,10 m);
  - frente de listones (**quitarlo**: empeora);
  - balda en corona de ±52° inclinada 8°, con aletas, lana y tela, y brazos hasta los laterales;
  - bandeja de 110 × 32 cm a 0,65 m con guías;
  - LED bajo los cantos, bajo la mesa, en la trasera y en el rebaje;
  - el Sub8 donde lo pone el análisis.
- **Imágenes:** `mesa/banco/imagenes/render_arco.html` (three.js; necesita `arco.json` con las piezas y la carpeta `three`) y `shoot.mjs` (Playwright).
  - Borradores en `mesa/Mesa_arco_borrador.png` y `Mesa_arco_borrador_lado.png`.
- **La geometría real dio peor que el banco:** 1,17 / 0,91 dB (`resultados/r1.json`, `r2.json`).
  - Se debía a caminos de difracción falsos: facetas de los laterales y cantos de 2 cm del rebaje.
  - Repetir con el motor corregido: «arco real sin frente», «sin laterales», etc., ya están en `agudos.spec.ts`.

## Pendiente (en orden)

1. **Motor corregido:**
   - suite completa y prueba completa;
   - endurecer la prueba de la tira;
   - `DESARROLLO.md`;
   - versión 0.10.3.
2. **Repetir las medidas con el motor corregido:**
   - «sin mesa» frente a «arco real sin frente», con D = 1,4 y el oyente en Y 4,19, `TRI='{"E":[2.05,1.1,-4.19],"D":1.4}'`;
   - variantes de ancho (`half` 0,96 / 1,08), con el teclado MIDI y con el pad.
   - Para ejecutarlas: copiar `mesa/banco/agudos/*.ts` a `acustica3d/src/tmp/` (ver `mesa/banco/LEEME.md`) (las rutas de `hfeval.ts` apuntan al `.skp` del usuario en el scratchpad; hay que cambiarlas) y correr `npx vitest run src/tmp/agudos.spec.ts --silent=false --reporter=verbose`.
3. **Ajustar la mesa «Arco»** según esos resultados:
   - quitar el frente de listones;
   - si hace falta, ensanchar o bajar los laterales cerca del rebote lateral (Y ≈ 5,1).
4. **Estética premium:**
   - más vistas y paletas (grafito y roble ahumado, blanco y roble, nogal);
   - sombras de 6 mm entre piezas, laminado supermate tipo Fenix, tela tipo Kvadrat, LED de 2700–3000 K.
   - Mantener los LED ocultos y las líneas paralelas y diagonales que le gustan.
5. **Gráficas:**
   - respuesta L/R de «sin mesa» frente a «Arco» de 300 Hz a 16 kHz;
   - fase;
   - reflectograma;
   - barras con todas las medidas;
   - alzado acotado (como `Alzado_mesa_util.png`, generado con `mesa/banco/imagenes/graficas.html`).
   - Al usuario le gusta verlas; enviarlas con `SendUserFile`.
6. **Actualizar `mesa/README.md` y `CLAUDE.md`:**
   - triángulo de 1,40 m;
   - mesa «Arco»;
   - corrección del motor;
   - reglas del manual.
7. **En la app:** fuente en el frontal del KH, apuntando al oído, y la caja como obstáculo en medios y agudos (`scene.ts`, `hf/`).

## Resultado con el motor corregido (última medida de la sesión)

Medido con D = 1,40, el oyente en (2,05, Y 4,19) y la geometría real de `mesaArco`, como media de 6 posiciones de cabeza. Datos en `mesa/banco/resultados/corregido_c1.json` y `corregido_c2.json`.

| | 0,3–3 kHz | 3–16 kHz | Total (peor) | Fase | L/R | Peine (< 2 ms) | 20 ms |
|---|---|---|---|---|---|---|---|
| Sin mesa | 1,56 dB | 0,53 dB | 1,25 (1,29) | 9,1° | 0,42 | −36,0 dB | −14,7 dB |
| **Arco sin frente de listones** | **1,08** | 0,62 | **0,93 (1,02)** | **7,1°** | **0,37** | −21,7 | **−20,7** |
| Arco con frente | 1,07 | 0,66 | 0,95 (1,13) | 7,1° | 0,41 | −21,3 | −20,3 |
| Arco a 2,16 m de ancho, sin frente | 1,06 | 0,62 | 0,92 (0,98) | 6,7° | 0,39 | −22,4 | −20,7 |

- **Frente a no tener mesa, la mesa «Arco» mejora:**
  - 0,3–3 kHz;
  - fase;
  - simetría L/R;
  - zona libre de reflexiones: −20,7 dB, cumple el objetivo de −20 dB;
  - total: de 1,25 a 0,93 dB.
- **Queda pendiente:**
  - de 3 a 16 kHz aún pierde 0,09 dB (0,62 frente a 0,53), muy por debajo de lo que se oye (unos 0,2 dB);
  - el peine pasa de −36 a −22 dB (más rebotes cortos, aunque débiles).
- **Siguiente paso:** quitar el frente de listones de `mesaArco`. El ancho apenas cambia nada; queda en `half` 0,96.
