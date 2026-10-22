# Acustica3D

Programa para Windows que simula cómo suenan los graves **en tu sala** a partir de su modelo 3D de SketchUp (abre el `.skp` directamente) y te dice dónde poner los altavoces, el subwoofer y tu silla.

- **Mapa de dónde se oye mejor:** en verde lo mejor y en rojo lo peor. Al mover la cabeza ves la curva de graves de ese punto al momento.
- **Colocación automática:** prueba combinaciones de altavoces, sub y posición de escucha por toda la sala y te propone las mejores, junto con los ajustes del sub (corte, nivel, fase) y de los interruptores de los altavoces.
- **Paneles y trampas de graves:** los pruebas en la simulación antes de comprarlos.
- **Mapa animado de la sala** de 20 a 300 Hz, para ver dónde se acumula o desaparece cada frecuencia.

## Descargar

**[Descargar Acustica3D para Windows](https://github.com/NapalmCandy/Acustica3D/releases/latest)**: descomprime `Acustica3D_win64.zip` y abre `Acustica3D.exe`.
- Se abre en su propia ventana.
- Se actualiza solo cuando hay una versión nueva.
- Necesita Windows 10 u 11 con Microsoft Edge o Google Chrome.

Instrucciones de uso en [acustica3d/README.md](acustica3d/README.md).

## Cómo funciona

1. **Modelo de la sala:** el plano 3D de SketchUp, con un material acústico para cada superficie (pladur, ladrillo, cristal, paneles…).
2. **Simulación:** Acustica3D divide el aire de la sala en millones de celdillas y calcula cómo viaja y rebota la onda de cada altavoz. Todo se hace en tu PC, con el procesador o con la tarjeta gráfica.
3. **Colocación:** con la respuesta en cada punto, puntúa cada posible sitio de escucha por varios criterios:
   - grave plano y sin huecos;
   - poco retumbe;
   - imagen estéreo simétrica y lejos de las paredes.

   Después busca la mejor combinación de altavoces, sub y silla.
4. **Corrección:** lo que queda, como los picos de grave o la fase del cruce, se corrige con el plugin. Los huecos no se arreglan con ecualización: se evitan colocando bien.
5. **Medida** (próximamente): con un micrófono de medida se calibra todo para tu sala real.

## También en este repositorio

- **KH120A Corrector:** plugin VST3/CLAP para el máster del DAW que corrige la respuesta y la fase de los Neumann KH 120 A.
  - Lleva filtros FIR en fase lineal o en baja latencia, y protege el woofer de los subgraves.
  - Los filtros actuales son provisionales: salen de un modelo del altavoz, a la espera de medidas reales.
  - Ver [plugin/LEEME_PLUGIN.md](plugin/LEEME_PLUGIN.md).
- **Modelo del KH 120 A:** datos, simulación del altavoz, distorsión y diseño de los filtros, en [LEEME_KH120A_DSP.md](LEEME_KH120A_DSP.md).
