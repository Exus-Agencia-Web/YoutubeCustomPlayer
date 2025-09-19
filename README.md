# lc-youtube-player

Componente Web `<lc-youtube>` para incrustar videos o playlists de YouTube con una capa de controles moderna, accesible y totalmente personalizable.

## Características
- Reproductor personalizado para videos y playlists (incluye navegación Anterior/Siguiente).
- Detección de transmisiones en vivo con indicador y botón «Ir al vivo».
- Controles propios: play/pause, barra de progreso, volumen, mute, doble tap para +/-10 s en móvil y botón de fullscreen.
- Pantalla completa más natural: doble clic activa/desactiva fullscreen y la tecla `Escape` lo cierra.
- Overlay inteligente: muestra la miniatura de YouTube cuando el video está en pausa o finalizado, con sombra configurable.
- Paleta de hasta cinco colores configurables mediante atributos, con valores predeterminados elegantes.
- Responsive, pensado para escritorio, móviles y embebidos en sitios o apps.

## Instalación rápida (CDN)

```html
<script src="https://cdn.jsdelivr.net/npm/lc-youtube-player@latest/youtube-player.min.js"></script>
```

Alternativa:

```html
<script src="https://unpkg.com/lc-youtube-player@latest/youtube-player.min.js"></script>
```

Una vez cargado el script puedes usar `<lc-youtube>` en tu HTML sin inicialización extra.

## Ejemplos

### Video individual
```html
<lc-youtube video="C4O7djfJZ9Q"></lc-youtube>
```

### Playlist con inicio en un elemento concreto
```html
<lc-youtube playlist="PL1234567890abcdef" index="2"></lc-youtube>
```

### Reproductor con autoplay y colores personalizados
```html
<lc-youtube
  video="C4O7djfJZ9Q"
  autoplay
  color-surface="#101820"
  color-text="#f6f7f9"
  color-accent="#ff3737"
  color-subtle="rgba(255,255,255,0.15)"
  color-overlay="rgba(0,0,0,0.45)"
></lc-youtube>
```

## Atributos soportados

| Atributo | Descripción |
|----------|-------------|
| `video` | ID o URL de YouTube para un video individual. |
| `playlist` | ID o URL de una playlist. |
| `index` | Posición inicial dentro de la playlist (1 = primero, 2 = segundo, `-1` = último). |
| `autoplay` | Si está presente, intenta iniciar la reproducción automáticamente. |
| `dvr-window` | Ventana (en segundos) para transmisiones en vivo con DVR. Predeterminado 4 horas. |
| `color-surface` | Color de fondo principal del contenedor. |
| `color-text` | Color base para textos e iconos. |
| `color-accent` | Color de acento para progreso, badge «EN VIVO», estados mute, etc. |
| `color-subtle` | Color base para botones, sliders y gradientes de controles. |
| `color-overlay` | Color usado para el overlay cuando el video está pausado (también aplica como sombra sobre la miniatura). |

Todos los atributos de color son opcionales; si no se especifican se usan los valores predeterminados del componente.

## Comportamiento de la UI
- **Pantalla completa:** doble clic sobre el overlay alterna fullscreen. `Escape` fuerza la salida. En móvil se mantiene soporte para doble tap ±10 s.
- **Overlay:** al pausar/finalizar el video se muestra la miniatura oficial de YouTube con el color `color-overlay` superpuesto al 35 %. Mientras reproduce, el overlay es transparente.
- **Autohide:** los controles aparecen con movimiento/touch y se ocultan automáticamente tras unos segundos.

## Instalación local (npm)

```bash
npm install lc-youtube-player
```

Incluye el fichero minificado en tu build:

```html
<script src="./node_modules/lc-youtube-player/youtube-player.min.js"></script>
```

## Publicación continua

El repositorio incluye un workflow de GitHub Actions que minifica `youtube-player.js` y publica automáticamente en npm. Para activarlo:
1. Configura el secreto `NPM_TOKEN` en GitHub.
2. Haz push a la rama `main`.

