#!/bin/bash

clear 

set -e

VERSION_TYPE=${1:-patch}

if [ "$VERSION_TYPE" != "patch" ] && [ "$VERSION_TYPE" != "minor" ] && [ "$VERSION_TYPE" != "major" ]; then
    echo "Error: Tipo de versión inválido. Usa 'patch', 'minor' o 'major'."
    exit 1
fi

echo "Actualizando desde el repositorio remoto..."
git pull

echo "Incrementando la versión $VERSION_TYPE..."
NEW_VERSION=$(npm version "$VERSION_TYPE" --no-git-tag-version)
NEW_VERSION=${NEW_VERSION#v}
echo 
echo

if ! git diff --quiet -- package.json package-lock.json 2>/dev/null; then
    echo "Creando commit Update $NEW_VERSION..."
    git add .  2>/dev/null || true
    git commit -m "Update $NEW_VERSION"
else
    echo "No se detectaron cambios de versión para commitear. Abortando."
    exit 0
fi

echo "Publicando los cambios en el repositorio..."
git push

echo
echo "¡Publicación de v$NEW_VERSION completada!"
echo