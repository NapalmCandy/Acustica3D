# Mesas acústicas para el Estudio v0.05

Dos diseños de mesa para los KH 120 A, calculados con la pestaña «Medios y agudos» de Acustica3D (método de la imagen con difracción por zonas de Fresnel y la directividad del KH 120 medida por Neumann) sobre el modelo `Estudio_v0.05.skp`.

| | Archivo para SketchUp | Lámina |
|---|---|---|
| **Con lana** en el tablero | [`Mesa_con_lana.dae`](Mesa_con_lana.dae) | [`Mesa_con_lana.png`](Mesa_con_lana.png) |
| **Sin lana**, con sitio para teclado, teclado MIDI y torre | [`Mesa_sin_lana.dae`](Mesa_sin_lana.dae) | [`Mesa_sin_lana.png`](Mesa_sin_lana.png) |
| **Tres cuerpos mejorada**: tu idea de cuerpos que se meten uno dentro de otro, con ruedas y los KH sobre la mesa | [`Mesa_tres_cuerpos.dae`](Mesa_tres_cuerpos.dae) | [`Mapa_tres_cuerpos.png`](Mapa_tres_cuerpos.png) |

Y el **mapa de zonas sensibles** con tu diseño original encima: [`Mapa_zonas_sensibles.png`](Mapa_zonas_sensibles.png).

Los `.dae` se generan con `node mesa/gen_mesas.mjs`.

## Resultado

Respuesta de cada KH en el oído (directo y reflexiones hasta 3 rebotes), de 300 Hz a 4 kHz en 1/6 de octava. Es la media de seis posiciones de la cabeza: la dibujada, centrada, 10 cm adelante y atrás, y 5 cm más alta y más baja. La pantalla está en todas.

| Mesa | Desviación de la respuesta | Reflexiones fuertes¹ | Energía en los primeros 20 ms² |
|---|---|---|---|
| Tu diseño de tres cuerpos (el dibujado en el v0.05) | 2,73 dB (2,3–3,1) | 6,8 | −8,9 dB |
| **Tres cuerpos mejorada** | **1,29 dB** (1,2–1,4) | 5,2 | −11,1 dB |
| **Con lana** | **1,12 dB** (0,9–1,3) | 0,8 | −13,9 dB |
| **Sin lana** | **1,29 dB** (1,0–1,5) | 1,8 | −12,6 dB |

¹ Por encima de −20 dB en los primeros 20 ms, de media por posición.
² Suma de las reflexiones respecto al directo, de 1 a 8 kHz.

El problema de una mesa con los KH detrás es el rebote del sonido en el tablero. Llega menos de 1 ms después del directo y a unos −8 dB, y hace un filtro en peine en medios. El punto de rebote lo fijan los KH y el oído: está a mitad de camino, a unos 75 cm por delante del oído (Y ≈ 4,92 m), a cualquier altura de tablero. Cada mesa lo resuelve de una forma:

- **Con lana:** el tablero sigue ahí, pero el rebote cae en una franja de lana de roca.
- **Sin lana:** no hay tablero en ese punto. Lo poco que queda delante está inclinado y desvía su rebote hacia el pecho, no al oído.

## Mesa con lana

- **Tablero** de 185 × 88 cm, plano, a 73 cm; desde Y 4,62 m (el borde delantero de la mesa actual) hasta 5,50 m.
- **Franja de lana de roca** de 80 kg/m³ y 5 cm de grosor, forrada de tela fina. Va a todo el ancho menos 3 cm por lado, con 30 cm de fondo, empezando a 23 cm del borde delantero. Delante quedan 23 cm para el teclado. Con fieltro en vez de lana, la desviación sube a 1,7 dB.
- **KH en pies de suelo** detrás de la mesa, sin tocarla, con la bandeja a 95 cm.
- **Pantalla** sobre la mesa, al fondo: 9 cm más baja que ahora, 5 cm más cerca de ti e inclinada 8° hacia atrás.

## Mesa sin lana

- **Franja de 185 × 32 cm** para el teclado del ordenador y el ratón. El borde delantero va a Y 4,50 m, 12 cm más cerca de ti que la mesa actual, y a 73 cm de altura.
  - Está **inclinada 10°**: el borde de atrás queda 5,6 cm más alto, como un tablero de dibujo.
  - Así, lo que rebota en ella va hacia tu pecho, unos 40 cm por debajo del oído, y su punto de rebote se sale de la franja.
  - Inclinarla al revés (el borde de delante más alto) empeora: la franja pasa a hacer de espejo hacia el oído.
  - Plana, la desviación es de unos 1,7 dB; a 10°, 1,3 dB. Más inclinada mejora poco.
- **Bandeja extraíble para el teclado MIDI**, de 105 × 30 cm, bajo la franja y a 60 cm de altura. Cabe un teclado de 61 teclas de hasta unos 28 cm de fondo y 10 cm de alto. Guardada o sacada, apenas cambia nada.
- **Torre del PC en el suelo**, bajo el extremo izquierdo (X 1,18–1,38 m, Y 4,80–5,25 m), fuera de los caminos del sonido de los KH al oído. En el `.dae` hay una torre y un teclado de ejemplo para ver el sitio: cámbialos por los tuyos.
- **Detrás no hay tablero.** La pantalla va en un brazo VESA sujeto al borde de atrás de la franja (la Samsung C34J791 admite VESA 100 × 100; compruébalo en su manual), en el mismo sitio que en la mesa con lana. Un tablero detrás, aunque sea plano y bajo, devuelve el rebote: la desviación sube a unos 3 dB.
- **KH en pies de suelo**, como en la otra.
- **Estructura:** los dos laterales del `.dae` son orientativos. Con 32 cm de fondo conviene una estructura de patas metálicas o un travesaño bajo atrás.

## Tu idea de tres cuerpos

La mesa dibujada en el v0.05 tiene tres cuerpos con ruedas que se meten uno dentro de otro:
- **alto:** a 92 cm, para los KH;
- **medio:** inclinado hacia los KH, para la pantalla y aparatos MIDI;
- **bajo:** a 66 cm, para el teclado y el ratón.

La inclinación del medio se eligió con un espejo en SketchUp: desde el oído no se ven los KH reflejados.

### Por qué no funciona

La prueba del espejo es óptica de rayos. Solo vale cuando la superficie es mucho más grande que la longitud de onda, y en medios no lo es: a 1 kHz la onda mide 34 cm y a 300 Hz más de un metro. El sonido no rebota en un punto. Rebota en una zona de 30–40 cm alrededor del punto de rebote (la zona de Fresnel), y los bordes de los tableros radian sonido hacia todos los lados (difracción).

El [mapa de zonas sensibles](Mapa_zonas_sensibles.png) lo enseña. Cada punto indica cuánto sonido manda a tu oído un borde de tablero que esté ahí. Rojo: mucho; blanco: nada. El **punto de rebote** cae siempre a mitad de camino entre el KH y el oído, a cualquier altura: unos 75 cm por delante de ti (Y ≈ 4,92 m). Con el cálculo completo, tus tres cuerpos dan tres reflexiones de unos −15 a −19 dB en el primer milisegundo. Juntas hacen un filtro en peine; con el KH izquierdo, por ejemplo, hay un valle de −7 dB entre 800 Hz y 1,3 kHz:

| Cuerpo | Qué pasa | Nivel (1–8 kHz) | Retardo |
|---|---|---|---|
| **Bajo** (teclado) | Está justo en el punto de rebote. El espejo no ve el KH porque lo tapa el borde del cuerpo medio por 9 cm, pero en medios el sonido rodea ese borde. | −15 dB | 1 ms |
| **Medio** | El tablero inclinado está bien (el espejo acierta), pero su borde delantero, a 82 cm, queda dentro de la zona roja y difracta. | −15 dB | 0,4–0,5 ms |
| **Alto** | Sobresale 9 cm por delante del frontal del KH: ese borde, justo debajo del altavoz, también difracta. | −17 a −19 dB | 0,3 ms |

Quitar solo uno de los tres apenas mejora: los otros dos siguen ahí. Hacer el medio a todo el ancho también perjudica, porque pasa por debajo de los propios KH: solo con eso, la desviación sube de 1,85 a 2,5 dB.

### La versión mejorada

Es la misma idea: tres cuerpos con ruedas que se meten uno dentro de otro, los KH sobre la mesa y la pantalla sobre ella, sin brazos ni pies. Sigue tres reglas del mapa:

1. **Debajo y detrás del KH casi nada molesta.** El cuerpo alto va ahí, con el borde delantero al ras del frontal del KH (dejarlo 3 cm volado apenas gana nada; al ras es más seguro).
2. **La franja del medio (Y de 5,40 a 4,50 m) no debe tener nada**, salvo muy abajo. Es donde está el punto de rebote.
3. **Entre los dos brazos de la «V» que forman los KH con tu oído hay un pasillo tranquilo.** El cuerpo medio va ahí, estrecho y detrás. El bajo va cerca de ti y más bajo.

| Cuerpo | Medidas | Altura | Dónde (Y) | Para qué |
|---|---|---|---|---|
| **Alto** | 185 × 40 cm | 95 cm | 5,55–5,95 | los KH, con su frontal al ras del borde |
| **Medio** | 105 × 38 cm | 74 cm | 5,40–5,78 | la pantalla (con su pie, al borde delantero) y aparatos pequeños a los lados |
| **Bajo** | 96 × 28 cm | 62 cm | 4,45–4,73 | teclado y ratón |

- Para guardarla, el bajo pasa por debajo del medio (62 cm < 72 cm, y cabe entre sus laterales) y el medio por debajo del alto (74 cm < 93 cm). Recogida ocupa 185 × 40 cm.
- La pantalla queda casi a la altura del frontal de los KH, a unos 1,3 m de tus ojos, algo lejos para una 34" panorámica. Con el cuerpo medio desde Y 5,30 (10 cm más cerca) solo empeora unos 0,1 dB; más cerca ya entra en la zona del rebote.
- El bajo a 62 cm es la altura típica de una bandeja de teclado. A 66 cm, como el tuyo, la desviación sube algo más de 0,1 dB.
- Un teclado MIDI de 61 teclas no cabe en esta mesa: el bajo tiene 96 cm de ancho. Si lo necesitas, la mesa sin lana sí tiene una bandeja para él.
- Lo que queda: cinco reflexiones débiles, de −16 a −20 dB. Las más fuertes vienen del borde del bajo y del borde bajo los KH, que es el precio de llevar los KH sobre la mesa. Rozan el criterio de −20 dB (algunas lo pasan por poco), pero la respuesta queda casi igual de plana que con la mesa sin lana.

**Piezas** (DM de 19 mm; las alturas cuentan ruedas de 7 cm):

| Cuerpo | Tablero | Laterales (2) | Además |
|---|---|---|---|
| Alto | 1850 × 400 | 400 × 860 | trasera de 1812 × 430 abajo, que también lo rigidiza; 4 ruedas |
| Medio | 1050 × 380 | 380 × 650 | travesaño trasero de 80 mm bajo el tablero; 4 ruedas |
| Bajo | 960 × 280 | 280 × 530 | travesaño trasero de 80 mm bajo el tablero; 4 ruedas |

**Seguridad** (niñas y gatos):
- Ruedas con freno en los tres cuerpos.
- Los KH sobre tacos antideslizantes de silicona, que también los aíslan de la madera. Si quieres más, una cinta o escuadra por detrás.
- El cuerpo alto mide 95 cm de alto y 40 cm de fondo. Para que no vuelque si alguien tira del borde, sujétalo a la pared con una cinta antivuelco o ponle peso abajo, por ejemplo en una balda baja con cosas pesadas.

**Estética** (fácil de hacer en DM pintado):
- Cantos redondeados con fresadora (radio de 6–10 mm). Quedan mejor y no hacen daño.
- Sella los cantos del DM antes de pintar.
- Cada cuerpo de un color, o los tres iguales con el canto de otro color. Escalonados, los tres niveles ya llaman la atención por sí solos.
- Un zócalo de 7 cm puede tapar las ruedas: acústicamente da igual, está a ras de suelo.

## Mesa útil (en marcha)

La mesa de tres cuerpos mejorada deja la balda de instrumentos lejos, donde no se alcanza. Aquí va lo útil primero:
- los instrumentos (teclado MIDI, pad, mesa de DJ) a mano, en una balda a 75 cm;
- la bandeja del teclado y el ratón debajo, a 66 cm, con 7 cm de hueco hasta la balda;
- los KH a la altura del oído medido, **1,10 m**, sin inclinarlos (el timbre no cambia al moverte con la silla);
- la pantalla entre los KH y detrás, con su centro a la altura de los ojos.

Archivo: [`Mesa_util.dae`](Mesa_util.dae). Los tres cuerpos con ruedas no son imprescindibles.

**Ideas probadas** para la balda de instrumentos, que está justo donde rebota el sonido. Media de seis posiciones de cabeza, con el oído centrado a 1,10 m:

| Opción | Desviación |
|---|---|
| Sin mesa (solo la sala) | 1,78 dB |
| Balda de madera, vacía | 2,18 dB |
| **Balda con una ventana de lana de roca de 152 × 28 cm, a ras, donde rebota el sonido** | **1,60 dB** |
| Lo mismo, con el teclado MIDI encima de la lana (de forma provisional) | 1,59 dB |
| Ventana de lana con rejilla metálica encima (chapa de 1,5 mm, agujeros de 10 mm, 40 % abierta) | 1,67 dB |
| DM de 19 mm taladrado, sin nada debajo (agujeros de 6–12 mm cada 16–25 mm) | 1,92–2,14 dB |
| DM de 19 mm taladrado sobre lana | 1,91 dB |
| Balda inclinada 15° con ventana de lana | 1,90 dB |
| Difusor QRD de 10 cm en la ventana (estimado; no se puede apoyar nada) | ≈ 1,8 dB |
| La mesa con lana de arriba (sin instrumentos a mano) | 1,37 dB |

- **La ventana de lana** deja la mesa acústicamente como si no estuviera: 1,60 dB, frente a 1,78 dB sin mesa. Con un instrumento encima de forma provisional, igual. Mejor con tela fina; con rejilla metálica fina, casi igual y más resistente.
- **El DM taladrado no sirve.** Con 19 mm de grosor cada agujero es un tubo de aire con masa: deja pasar los graves, que aquí no importan, y refleja de 1 kHz para arriba, que es justo lo que molesta. Solo funciona muy fino y muy abierto, y eso ya es una rejilla.
- **Los difusores tampoco.** Para actuar a 500 Hz–2 kHz necesitan 10 cm de fondo o más. Uno de taladros ciegos de 3 cm solo trabaja por encima de 2–4 kHz.
- **Lo que queda ya es de la sala:** el rebote en el suelo, el techo y las paredes. Para bajar de ahí ayuda que la mesa tape el suelo sin reflejar, como hace la mesa con lana.

## Cómo meterla en tu modelo

1. Saca la pantalla del grupo de la mesa actual y borra la mesa.
2. En SketchUp, abre *Archivo → Importar*, elige el `.dae` y haz clic en el origen de los ejes. Las coordenadas ya son las del Estudio v0.05.
3. Coloca la pantalla como se indica arriba.
4. Al cargar el `.skp` en Acustica3D:
   - la lana de la mesa se queda fija como parte de la mesa (no la mueve la colocación automática);
   - los pies y la torre se reconocen como metal y el teclado como plástico duro.

## Límites del cálculo

- No se modela tu cuerpo. En la mesa sin lana, el rebote de la franja va a tu pecho; la ropa absorbe parte de los agudos, pero algo vuelve.
- Tampoco se modela la superficie real de los teclados (las teclas dispersan) ni la difusión de las superficies.
- El mapa de zonas sensibles es un cálculo rápido (zonas de Fresnel y difracción de un borde recto, con la directividad del KH). Las cifras de las tablas son del cálculo completo.
- Se han usado las posiciones de los KH y del oído del dibujo. Si la colocación automática los mueve, el punto de rebote se desplaza y conviene volver a mirar la pestaña «Medios y agudos».
