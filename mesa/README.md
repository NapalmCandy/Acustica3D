# Mesas acústicas para el Estudio v0.05

Dos diseños de mesa para los KH 120 A, calculados con la pestaña «Medios y agudos» de Acustica3D (método de la imagen con difracción por zonas de Fresnel y la directividad del KH 120 medida por Neumann) sobre el modelo `Estudio_v0.05.skp`.

| | Archivo para SketchUp | Lámina |
|---|---|---|
| **Con lana** en el tablero | [`Mesa_con_lana.dae`](Mesa_con_lana.dae) | [`Mesa_con_lana.png`](Mesa_con_lana.png) |
| **Sin lana**, con sitio para teclado, teclado MIDI y torre | [`Mesa_sin_lana.dae`](Mesa_sin_lana.dae) | [`Mesa_sin_lana.png`](Mesa_sin_lana.png) |

Los `.dae` se generan con `node mesa/gen_mesas.mjs`.

## Resultado

Respuesta de cada KH en el oído (directo y reflexiones hasta 3 rebotes), de 300 Hz a 4 kHz en 1/6 de octava. Es la media de seis posiciones de la cabeza: la dibujada, centrada, 10 cm adelante y atrás, y 5 cm más alta y más baja.

| Mesa | Desviación de la respuesta | Reflexiones fuertes¹ | Energía en los primeros 20 ms² |
|---|---|---|---|
| La dibujada en el v0.05 | 2,75 dB (2,3–3,1) | 6,7 | −9,1 dB |
| **Con lana** | **1,11 dB** (0,9–1,3) | 0,7 | −14,4 dB |
| **Sin lana** | **1,22 dB** (1,0–1,4) | 1,3 | −13,1 dB |
| Sin lana, con el teclado MIDI sacado | 1,19 dB (1,1–1,3) | 1,5 | −13,6 dB |

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
  - | Inclinación | 0° | 6° | 10° | 15° |
    |---|---|---|---|---|
    | Desviación | 1,73 dB | 1,39 dB | 1,22 dB | 1,13 dB |
- **Bandeja extraíble para el teclado MIDI**, de 105 × 30 cm, bajo la franja y a 60 cm de altura. Cabe un teclado de 61 teclas de hasta unos 28 cm de fondo y 10 cm de alto. Guardada o sacada, apenas cambia nada.
- **Torre del PC en el suelo**, bajo el extremo izquierdo (X 1,18–1,38 m, Y 4,80–5,25 m), fuera de los caminos del sonido de los KH al oído. En el `.dae` hay una torre y un teclado de ejemplo para ver el sitio: cámbialos por los tuyos.
- **Detrás no hay tablero.** La pantalla va en un brazo VESA sujeto al borde de atrás de la franja (la Samsung C34J791 admite VESA 100 × 100; compruébalo en su manual), en el mismo sitio que en la mesa con lana. Un tablero detrás, aunque sea plano y bajo, devuelve el rebote: la desviación sube a 3,0 dB.
- **KH en pies de suelo**, como en la otra.
- **Estructura:** los dos laterales del `.dae` son orientativos. Con 32 cm de fondo conviene una estructura de patas metálicas o un travesaño bajo atrás.

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
- Se han usado las posiciones de los KH y del oído del dibujo. Si la colocación automática los mueve, el punto de rebote se desplaza y conviene volver a mirar la pestaña «Medios y agudos».
