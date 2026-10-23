# Banco de pruebas de las mesas (scripts de las sesiones)

No forman parte de la app ni de sus pruebas: van fuera de `acustica3d/src` para que `npx vitest run` no los ejecute.

**Para usarlos:**
1. Copia la carpeta que necesites a `acustica3d/src/tmp/`.
2. Cambia la ruta del `.skp` del usuario (`F` en `hfeval.ts`). El modelo no se sube al repositorio.
3. Ejecuta, por ejemplo: `npx vitest run src/tmp/agudos.spec.ts --silent=false --reporter=verbose`.
4. Borra `src/tmp` antes de hacer commit.

| Carpeta | Qué hay |
|---|---|
| `agudos/` | El banco de medios y agudos. |
| `graves/` | Búsqueda del triángulo de 60° con el worker de la colocación automática. |
| `optica_fisica/` | Comprobación independiente (integral de Kirchhoff) de rebotes en tiras finas y en el lateral. |
| `imagenes/` | Imágenes de las mesas y gráficas. |
| `otros/` | Scripts anteriores, por si hacen falta. |
| `resultados/` | Resultados en JSON. |

Detalle de cada carpeta:

- **`agudos/`**
  - `hfeval.ts`: carga la sala, la monta y evalúa con `findPaths`; da la respuesta L/R, la fase y las reflexiones.
  - `desk.ts`: materiales extra y `moveScreen`.
  - `desk3.ts`: geometría paramétrica (triángulo, cajas de los KH, arcos).
  - `prism.ts`: el prisma usado para los teclados y el pad.
  - `agudos.spec.ts`: el banco de variantes. Variantes en `VARS`, separadas por comas y sin comas en los nombres; triángulo en `TRI`; también `SUB` y `HALF`.
  - `modelo.spec.ts`: modelo antiguo frente al corregido.
  - `estetica.spec.ts`: la mesa útil con diseño.
  - `scr.spec.ts`: medidas de la pantalla y de cada material.
- **`graves/triangulo.spec.ts`:** búsqueda del triángulo de 60° (`DIST=1.4 TAG=tri_1.4`).
- **`optica_fisica/`:** `po_tiras.mjs`, `po_lateral.mjs`.
- **`imagenes/`**
  - `render_arco.html` y `render_mesa_util.html`: three.js. Se sirven con `python3 -m http.server 8765` junto a una carpeta `three` (`node_modules/three`) y al `arco.json` exportado de `collect(mesaArco)`.
  - `shoot.mjs`: capturas con Playwright (`PAGE=arco.html node shoot.mjs vista:paleta:salida.png`).
  - `graficas.html` + `shoot_charts.mjs`: gráficas de respuesta, reflexiones, desviación y alzado.
  - `mapa_render.mjs` + `disenos.json`: mapa de zonas sensibles.
- **`resultados/`**
  - `graves_triangulo_*.json`: graves por tamaño de triángulo.
  - `t*.json`: agudos por tamaño (antes de corregir el motor).
  - `f14*.json`: diseño final con D = 1,4 (antes de corregir el motor).
  - `r*.json`: la geometría real de la mesa «Arco» (antes de corregir el motor).
  - `anteriores/`: lo que se guardaba en el área temporal de la sesión.
    - `estetica.json`: curvas de la mesa útil.
    - `modelo.json`: modelo antiguo frente al corregido.
    - `triangulo.json`: primera búsqueda de graves con todos los tamaños.
    - `mapas_110.json`: mapa de zonas sensibles con el oído a 1,10 m.
    - `curves*.json`: curvas antiguas.
    - `kh120_*.json`: directividad leída del manual.
