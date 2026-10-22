# Acustica3D

Simula cómo suenan los graves en **tu sala** a partir de su modelo 3D de SketchUp, y te dice dónde poner los altavoces, el subwoofer y tu posición de escucha.

## Descargar

1. En [Releases](https://github.com/NapalmCandy/Acustica3D/releases/latest) descarga **`Acustica3D_win64.zip`**.
2. Descomprímelo en Documentos o en el Escritorio.
3. Abre **`Acustica3D.exe`**.

Se abre en su propia ventana y **se actualiza solo** cuando hay una versión nueva. Puedes fijarlo a la barra de tareas (clic derecho en su icono > *Anclar a la barra de tareas*): se abre siempre con el icono de Acustica3D. Necesita Windows 10 u 11, con Microsoft Edge o Google Chrome instalado.

## Cómo se usa

1. **Prepara el modelo en SketchUp.** Da a cada superficie un material con un nombre claro (`Pladur`, `Falso_techo`, `Suelo_tarima`, `Ventana`, `Puerta`, `Escritorio`, `Panel_LR_50mm`…).
2. **Cárgalo en Acustica3D.**
   - Abre directamente el archivo **`.skp`** (SketchUp 2021 o posterior); no hace falta exportar nada.
   - Lo que esté oculto o en etiquetas ocultas no se carga, igual que no se ve en SketchUp.
   - También acepta `.dae`, `.obj` y `.glb`.
3. **Revisa los materiales.** Comprueba el material acústico que se ha asignado a cada superficie.
   - Acustica3D reconoce lo que has dibujado: los altavoces (pasan a ser las fuentes), la persona y su silla (tu cabeza es la posición de escucha), y las trampas y paneles de lana (pasan a ser objetos que se pueden mover, con su forma, grosor y cámara de aire).
   - Si escribes la densidad en el nombre del material de la lana («Lana de roca 80kg/m3») se usa esa; algunos productos se reconocen por el nombre (ROCKWOOL Sonorock Eco, Plus).
   - En paredes y techos dibujados por capas (pladur, lana, ladrillo, forjado), la superficie toma el material según lo que tiene detrás.
   - Desmarca «cuenta» en un material para que sea acústicamente transparente (por ejemplo, una mesa provisional) y compara.
4. **Coloca tus altavoces, el sub y tu cabeza.** Puedes escribir coordenadas o arrastrarlos en 3D. Añade paneles, trampas de graves o muebles si quieres probarlos.
5. **Mira los resultados.** La simulación arranca sola y se va afinando en unos segundos; si mueves algo, se recalcula.

¿Aún no tienes el modelo? Pulsa **Sala de ejemplo**.

## Qué te muestra

- **Mejor posición:** mapa en verde (mejor) y rojo (peor) de dónde sentarte con los altavoces donde están. Al mover la cabeza ves la curva de graves de ese punto al instante. Puedes elegir qué frecuencias cuentan, por ejemplo 40–200 Hz si tu música o tu sub no bajan más.
- **Colocación automática:** prueba combinaciones de altavoces, sub y posición de escucha por toda la sala y te propone las mejores.
  - Por defecto usa una **búsqueda bayesiana**: simula unos sitios repartidos por la sala y después va eligiendo dónde simular según lo que ya ha visto, así que termina antes que recorriendo la sala entera (también puedes elegir la rejilla completa).
  - También ajusta el sub (corte, nivel, fase y filtro de 85 Hz) y los interruptores Bass y Low-Mid de los KH 120 A.
  - Te dice cuánto ganarías sin mover nada, solo con esos ajustes.
  - Con un clic lo coloca y lo ajusta todo así.
  - Con «Mover también trampas y paneles» lleva los paneles a los puntos de primera reflexión y prueba las trampas de esquina en otras esquinas y aristas (cada distribución es una simulación nueva, así que tarda bastante más).
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
