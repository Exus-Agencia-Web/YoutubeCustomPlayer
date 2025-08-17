# lc-youtube-player

Componente Web para reproducir videos de YouTube con controles personalizados.

## Instalación y uso desde CDN

Puedes usar el archivo minificado directamente desde un CDN como jsDelivr o unpkg, sin necesidad de instalar nada:

```html
<script src="https://cdn.jsdelivr.net/npm/lc-youtube-player@1.0.0/youtube-player.min.js"></script>
```
O:
```html
<script src="https://unpkg.com/lc-youtube-player@1.0.0/youtube-player.min.js"></script>
```

## Ejemplo de integración

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Demo lc-youtube-player</title>
  <script src="https://cdn.jsdelivr.net/npm/lc-youtube-player@1.0.0/youtube-player.min.js"></script>
</head>
<body>
  <h3>Demo: &lt;lc-youtube video="C4O7djfJZ9Q"&gt;</h3>
  <lc-youtube video="C4O7djfJZ9Q"></lc-youtube>
</body>
</html>
```

## Ejemplos avanzados

### Video individual con autoplay

```html
<lc-youtube video="C4O7djfJZ9Q" autoplay="1"></lc-youtube>
```

### Playlist por ID con index y autoplay

```html
<lc-youtube playlist="PL9tY0BWXOZFtj6o7r8D0a9yW8Bv6jGx9Q" index="2" autoplay="1"></lc-youtube>
```

### Playlist con URL `videoseries`

```html
<lc-youtube playlist="videoseries?list=PL9tY0BWXOZFtj6o7r8D0a9yW8Bv6jGx9Q"></lc-youtube>
```

## Uso en proyectos locales

Instala el paquete:

```sh
npm install lc-youtube-player
```

Luego importa el archivo minificado en tu proyecto:

```html
<script src="./node_modules/lc-youtube-player/youtube-player.min.js"></script>
```

## Publicación automática en npm

Este repositorio incluye un workflow de GitHub Actions que:
- Minifica el archivo `youtube-player.js` usando Terser.
- Publica el paquete en npm con el archivo `youtube-player.min.js`.

Para publicar automáticamente:
1. Agrega el secreto `NPM_TOKEN` en la configuración de GitHub.
2. Haz push a la rama `main`.

## Personalización

Puedes usar el componente `<lc-youtube>` en tu HTML y pasarle los atributos `video`, `playlist`, `index` y `autoplay` para controlar la reproducción de videos o listas de reproducción de YouTube:

```html
<lc-youtube video="C4O7djfJZ9Q" autoplay="1"></lc-youtube>
```

## Autor
Exus Agencia Web

## Licencia
MIT
