# Acustica3D

Herramientas propias para sacar el máximo de un estudio pequeño con **Neumann KH 120 A** y **ADAM Sub8**. Incluye simulación acústica de la sala, colocación de equipos, corrección DSP y medidas.

| Parte | Qué es | Dónde |
|---|---|---|
| **Sala3D** | Simulación acústica 3D de la sala a partir del modelo de SketchUp. Mapas, mejor posición de escucha, colocación automática de KH, sub y oyente, y tratamiento. | [`sala3d/`](sala3d/README.md) |
| **KH120A Corrector** | Plugin VST3/CLAP con los filtros FIR de corrección (fase lineal o baja latencia). | [`plugin/`](plugin/LEEME_PLUGIN.md) |
| **Modelo y filtros del KH 120 A** | Datos, modelo Thiele-Small, difracción, distorsión, diseño de los FIR y gráficas. | [`LEEME_KH120A_DSP.md`](LEEME_KH120A_DSP.md), `src/`, `filtros/`, `graficas/` |

## Descargar Sala3D para Windows

En **[Releases](../../releases/latest)** descarga `Sala3D_win64.zip`.
1. Descomprímelo.
2. Abre `Sala3D.exe`.

A partir de ahí se **actualiza solo**: al abrirse mira si hay una versión nueva aquí, la descarga en segundo plano y la instala al cerrar (o al momento con «Reiniciar ahora»).

## Publicar una versión nueva

Sube el número de versión de `sala3d/package.json` y súbelo a `main`:

```bash
cd sala3d
npm version patch --no-git-tag-version   # 0.3.0 → 0.3.1 (minor: 0.4.0)
git commit -am "Sala3D 0.3.1" && git push
```

GitHub Actions ([`release.yml`](.github/workflows/release.yml)) hace el resto:
1. Pasa las pruebas.
2. Compila la app web y `Sala3D.exe` con esa versión.
3. Publica la release `v0.3.1` con el `.zip` y el `.pack`, el paquete que usa el actualizador.

Los `Sala3D.exe` ya instalados la detectan solos. También se puede lanzar a mano desde **Actions → Publicar versión de Sala3D → Run workflow**; si esa versión ya está publicada, no hace nada.

En cada cambio en `sala3d/` se pasan además las comprobaciones de [`pruebas.yml`](.github/workflows/pruebas.yml): tipos, 17 pruebas de física y compilación.

## Clonar

El plugin usa DPF y PFFFT como submódulos:

```bash
git clone --recursive https://github.com/NapalmCandy/Acustica3D.git
```

`CLAUDE.md` resume el contexto del proyecto (equipo, sala, decisiones y pendientes) para seguir trabajando con Claude Code.
