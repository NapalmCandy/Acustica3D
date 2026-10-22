# Acustica3D

Simula cómo suenan los graves en **tu sala** a partir de su modelo 3D de SketchUp, y te dice dónde poner los altavoces, el subwoofer y tu posición de escucha.

## Descargar

1. En [Releases](https://github.com/NapalmCandy/Acustica3D/releases/latest) descarga **`Acustica3D_win64.zip`**.
2. Descomprímelo en Documentos o en el Escritorio.
3. Abre **`Acustica3D.exe`**.

Se abre en su propia ventana y **se actualiza solo** cuando hay una versión nueva. Necesita Windows 10 u 11, con Microsoft Edge o Google Chrome instalado.

## Cómo se usa

1. **Prepara el modelo en SketchUp.** Da a cada superficie un material con un nombre claro (`Pladur`, `Falso_techo`, `Suelo_tarima`, `Ventana`, `Puerta`, `Escritorio`, `Panel_LR_50mm`…).
2. **Expórtalo.** Ve a *Archivo › Exportar › Modelo 3D › COLLADA (.dae)*:
   - marca *Triangular todas las caras* y *Exportar caras de dos lados*;
   - desmarca aristas y texturas.
3. **Cárgalo en Acustica3D.** Revisa el material acústico que se ha asignado a cada superficie (también acepta `.obj` y `.glb`).
4. **Coloca tus altavoces, el sub y tu cabeza.** Puedes escribir coordenadas o arrastrarlos en 3D. Añade paneles, trampas de graves o muebles si quieres probarlos.
5. **Mira los resultados.** La simulación arranca sola y se va afinando en unos segundos; si mueves algo, se recalcula.

¿Aún no tienes el modelo? Pulsa **Sala de ejemplo**.

## Qué te muestra

- **Mejor posición:** mapa en verde (mejor) y rojo (peor) de dónde sentarte con los altavoces donde están. Al mover la cabeza ves la curva de graves de ese punto al instante. Puedes elegir qué frecuencias cuentan, por ejemplo 40–200 Hz si tu música o tu sub no bajan más.
- **Colocación automática:** prueba combinaciones de altavoces, sub y posición de escucha por toda la sala y te propone las mejores. Con un clic lo coloca todo así.
- **Respuesta:** la curva de graves en tu sitio. Distingue los picos, que se pueden recortar con ecualización, de los huecos, que no.
- **Decaimiento:** cuánto tarda en apagarse cada frecuencia, es decir, cuánto "retumba" la sala.
- **Mapa de la sala:** cómo se reparte cada frecuencia por la habitación, de 20 a 300 Hz. Con **Play** se ve el barrido animado.
- **Superficies y reverberación:** cuánto absorbe cada material y el tiempo de reverberación de la sala.

## Cómo funciona

Acustica3D divide el aire de la sala en millones de celdillas y calcula cómo viaja la onda de cada altavoz, rebotando en paredes, techo y muebles según el material de cada superficie. Es una simulación de ondas (FDTD), la forma más fiel de calcular los graves en una habitación.

Todo se calcula en tu PC, con el procesador o con la tarjeta gráfica. Con esos datos puntúa cada posible sitio de escucha por varios criterios, todos con un peso ajustable:
- grave plano y sin huecos;
- poco retumbe;
- estable al mover la cabeza;
- imagen estéreo simétrica y lejos de las paredes.

## Limitaciones

- Por ahora calcula **los graves**, hasta unos 300 Hz. Para medios y agudos solo da el tiempo de reverberación; las reflexiones tempranas y dónde poner los paneles llegarán más adelante.
- Los materiales usan valores típicos. Con medidas reales del micrófono (REW) se podrán ajustar a tu sala.
- Las puntuaciones sirven para **comparar** sitios entre sí, no como nota absoluta.
