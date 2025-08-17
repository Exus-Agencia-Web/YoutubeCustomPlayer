# lc-youtube-player

Componente Web para reproducir videos de YouTube con controles personalizados.


# lc-youtube-player

Componente Web para reproducir videos y playlists de YouTube con controles personalizados y experiencia moderna.

## Características principales
- Reproductor embebido de YouTube como Web Component (`<lc-youtube>`)
- Soporte para videos individuales y playlists
- Controles personalizados: play/pause, barra de progreso, volumen, pantalla completa
- Botones "Anterior" y "Siguiente" para playlists
- Detección automática de transmisiones en vivo ("EN VIVO")
- Navegación por playlist con desactivación automática de botones en extremos
- Atributo `index` natural: `index="1"` es el primer video, `index="2"` el segundo, etc. `index="-1"` inicia en el último video
- Integración fácil vía CDN (jsDelivr/unpkg) o instalación local
- Responsive y compatible con dispositivos móviles

## Uso rápido desde CDN

Incluye el script minificado en tu HTML:

```html
<script src="https://cdn.jsdelivr.net/npm/lc-youtube-player@latest/youtube-player.min.js"></script>
```
O:
```html
<script src="https://unpkg.com/lc-youtube-player@latest/youtube-player.min.js"></script>
```

## Ejemplo básico

```html
<lc-youtube video="C4O7djfJZ9Q"></lc-youtube>
```

## Ejemplo con playlist y navegación

```html
<lc-youtube playlist="PL1234567890abcdef" index="2"></lc-youtube>
```
- `playlist`: ID de la playlist de YouTube (puedes usar la URL completa, el componente extrae el ID)
- `index`: número natural (1=primer video, 2=segundo, -1=último video)

## Atributos disponibles
- `video`: ID del video de YouTube (para videos individuales)
- `playlist`: ID o URL de la playlist
- `index`: posición inicial (1=primero, 2=segundo, -1=último)
- `autoplay`: inicia la reproducción automáticamente (opcional)

## Instalación local (npm)

```sh
npm install lc-youtube-player
```
Luego incluye el script en tu proyecto:
```html
<script src="./node_modules/lc-youtube-player/youtube-player.min.js"></script>
```

## Personalización y eventos
Puedes usar el componente en cualquier parte de tu HTML. Los controles y la experiencia están listos para usarse, no necesitas inicializar nada extra.

## Publicación automática en npm
Este repositorio incluye un workflow de GitHub Actions que:
- Minifica el archivo `youtube-player.js` usando Terser
- Publica el paquete en npm con el archivo `youtube-player.min.js`

Para publicar automáticamente:
1. Agrega el secreto `NPM_TOKEN` en la configuración de GitHub
2. Haz push a la rama `main`

## Ejemplo completo de integración

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Demo lc-youtube-player</title>
  <script src="https://cdn.jsdelivr.net/npm/lc-youtube-player@1.0.0/youtube-player.min.js"></script>
</head>
<body>
  <h3>Demo: &lt;lc-youtube playlist="PL1234567890abcdef" index="-1"&gt;</h3>
  <lc-youtube playlist="PL1234567890abcdef" index="-1"></lc-youtube>
</body>
</html>
```

## Autor
Exus Agencia Web

## Licencia
MIT
1. Agrega el secreto `NPM_TOKEN` en la configuración de GitHub.
2. Haz push a la rama `main`.

## Personalización

Puedes usar el componente `<lc-youtube>` en tu HTML y pasarle los atributos `video`, `playlist`, `index` y `autoplay` para controlar la reproducción de videos o listas de reproducción de YouTube:

```html
<lc-youtube video="C4O7djfJZ9Q" autoplay="1"></lc-youtube>
```

