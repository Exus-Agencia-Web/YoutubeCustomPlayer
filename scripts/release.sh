#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# release.sh — despliegue incremental para GitHub Actions
#
# Uso:
#   bash scripts/release.sh <develop>
#   ./release.sh <develop>     (tras chmod +x)
#
# Argumento obligatorio: selecciona el grupo de servidores de destino.
# El workflow de GitHub Actions mapea rama → argumento y lo pasa aquí.
# Depth se configura abajo via COMMITSDEPTH.
#
# Autenticación:
#   Solo por llave SSH (sin usuario/contraseña).
#   Cada servidor puede tener su propia llave via el 5º campo del array,
#   que es el NOMBRE de una variable de entorno con el contenido PEM.
#   Si el 5º campo se omite, se usa la llave global:
#     SSH_PRIVATE_KEY        Contenido PEM (secret GH Actions). Se escribe a tmp.
#     SSH_PRIVATE_KEY_PATH   Ruta a llave existente en disco.
#
# Opcional:
#   RELEASE_CONFIG         Ruta a JSON con array "ignore". Default .vscode/sftp.json
#
# Diferencia con deploy.sh:
#   - Solo commits reales del rango HEAD~DEPTH..HEAD.
#   - Sin cambios locales ni untracked.
#   - Sin prompts. Sin interacción.
#   - Hosts/puertos/rutas viven en el array SERVERS de este script.
# ============================================================

# ---------- Config interna (editable) ----------
# Formato por entrada: "host|port|user|remote_path[|KEY_ENV_VAR]"
# - Puerto y usuario son personalizables por servidor.
# - KEY_ENV_VAR (opcional): nombre de la variable/secret que contiene
#   el PEM para ESE servidor. Si se omite, cae a la llave global.
#
# El argumento posicional determina qué array se usa:
#   develop      -> DEVELOP_SERVERS
#   production   -> MASTER_SERVERS
# Cualquier otro valor aborta con error.

# Servidores para rama develop (desarrollo / staging)
DEVELOP_SERVERS=(
  "developers.pagegear.co|19840|ec2-user|/PageGearCloud/www/html/pge/dominios/YoutubeCustomPlayer|AWS1_SSH_KEY"
)

# Servidores para rama master (producción)
MASTER_SERVERS=(
  "cloud.pagegear.co|19840|ec2-user|/PageGearCloud/www/html/pge/dominios/YoutubeCustomPlayer|AWS1_SSH_KEY"
)

# DEPTH se lee del env var COMMITSDEPTH (GitHub Actions secret).
# Fallback a 1 para ejecuciones locales sin env. Se valida más abajo.
if [[ -n "${COMMITSDEPTH:-}" ]]; then
  DEPTH="$COMMITSDEPTH"
  DEPTH_SOURCE="COMMITSDEPTH env"
else
  DEPTH=1
  DEPTH_SOURCE="fallback=1 (sin COMMITSDEPTH)"
fi

# Exclusiones específicas de CI que se suman a las de .vscode/sftp.json.
# Motivo: sftp.json es compartido con deploy.sh (uso local); acá van cosas
# que SOLO release.sh (CI) debe ignorar, como metadata de GitHub Actions.
EXTRA_IGNORE_PATTERNS=(
  ".github/"
  ".vscode/"
  ".claude/"
  "docker/"
  "docs/"
)

# Validación de versión de rsync en el servidor remoto.
# rsync <3.2 no crea --temp-dir/--partial-dir automáticamente; el script ya lo
# mitiga pre-creándolos, así que esto es informativo por defecto.
MIN_RSYNC_VERSION="3.2.0"
AUTO_UPDATE_RSYNC=1   # 1 = intentar `sudo` update si la versión es vieja
# ------------------------------------------------

ts()   { date '+%H:%M:%S'; }
log()  { printf '[release %s] %s\n' "$(ts)" "$*"; }
err()  { printf '[release %s][ERROR] %s\n' "$(ts)" "$*" >&2; }
die()  { err "$*"; exit 1; }
step() { printf '[release %s]   → %s\n' "$(ts)" "$*"; }

banner() {
  local title="$1"
  local line
  line="$(printf '%0.s=' {1..72})"
  printf '\n'
  printf '%s\n' "$line"
  printf '  %s\n' "$title"
  printf '%s\n' "$line"
}

server_banner() {
  local idx="$1" total="$2" host="$3"
  local line
  line="$(printf '%0.s#' {1..72})"
  printf '\n'
  printf '%s\n' "$line"
  printf '#  [%d/%d] SERVIDOR: %s\n' "$idx" "$total" "$host"
  printf '#  hora: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
  printf '%s\n' "$line"
}

# version_ge <a> <b> → 0 si a >= b, 1 si no. Usa sort -V (GNU sort).
version_ge() {
  [[ "$1" == "$2" ]] && return 0
  local smaller
  smaller="$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -n1)"
  [[ "$smaller" == "$2" ]]
}

# ---------- Dependencias ----------
for cmd in git rsync ssh python3 awk sort mktemp dirname basename nl wc tr; do
  command -v "$cmd" >/dev/null 2>&1 || die "Falta dependencia: $cmd"
done

# ---------- Repo ----------
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[[ -n "$REPO_ROOT" ]] || die "No se encuentra repositorio git"
cd "$REPO_ROOT"

# Validar DEPTH: entero positivo
[[ "$DEPTH" =~ ^[1-9][0-9]*$ ]] \
  || die "COMMITSDEPTH debe ser un entero positivo, recibido: '$DEPTH'"

if ! git rev-parse --verify "HEAD~${DEPTH}^{commit}" >/dev/null 2>&1; then
  die "Historial insuficiente para HEAD~${DEPTH}. En actions/checkout use fetch-depth: 0 (o >= $((DEPTH + 1)))"
fi

BASE_COMMIT="$(git rev-parse "HEAD~${DEPTH}")"
HEAD_COMMIT="$(git rev-parse HEAD)"

# ---------- Selección de servidores por argumento ----------
# El primer argumento posicional define el ambiente de destino. El workflow
# de GitHub Actions mapea rama → argumento. La rama git se conserva solo
# como metadato informativo en los logs.
TARGET="${1:-}"
[[ -n "$TARGET" ]] || die "Falta argumento de ambiente. Uso: release.sh <develop>"

BRANCH="${GITHUB_REF_NAME:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')}"

SERVERS=()
ENV_LABEL=""
case "$TARGET" in
  develop)
    ENV_LABEL="DEVELOP"
    SERVERS=("${DEVELOP_SERVERS[@]+"${DEVELOP_SERVERS[@]}"}")
    ;;
  production)
    ENV_LABEL="PRODUCTION"
    SERVERS=("${MASTER_SERVERS[@]+"${MASTER_SERVERS[@]}"}")
    ;;
  *)
    die "Ambiente '$TARGET' no reconocido. Válidos: develop | production"
    ;;
esac

# ---------- Validar SERVERS ----------
[[ "${#SERVERS[@]}" -gt 0 ]] || die "Array de servidores para ambiente '$TARGET' está vacío"
for entry in "${SERVERS[@]}"; do
  IFS='|' read -r _h _p _u _rp _kv <<< "$entry"
  [[ -n "${_h:-}" && -n "${_p:-}" && -n "${_u:-}" && -n "${_rp:-}" ]] \
    || die "Entrada SERVERS inválida: '$entry' (formato: host|port|user|remote_path[|KEY_ENV_VAR])"
done
unset _h _p _u _rp _kv

# ---------- Config ignore ----------
CONFIG_FILE="${RELEASE_CONFIG:-$REPO_ROOT/.vscode/sftp.json}"
IGNORE_PATTERNS=()
if [[ -f "$CONFIG_FILE" ]]; then
  while IFS= read -r pat; do
    [[ -n "$pat" ]] && IGNORE_PATTERNS+=("$pat")
  done < <(python3 - "$CONFIG_FILE" <<'PY'
import json, sys
try:
    with open(sys.argv[1], "r", encoding="utf-8") as f:
        cfg = json.load(f)
    for item in cfg.get("ignore", []):
        print(item)
except Exception as e:
    sys.stderr.write(f"[release] aviso: no se pudo leer ignore de {sys.argv[1]}: {e}\n")
PY
)
else
  log "Aviso: $CONFIG_FILE no existe, sin patrones ignore"
fi

# Merge de exclusiones CI-only
for pat in "${EXTRA_IGNORE_PATTERNS[@]+"${EXTRA_IGNORE_PATTERNS[@]}"}"; do
  IGNORE_PATTERNS+=("$pat")
done

# ---------- Tmp + trap ----------
TMP_ALL="$(mktemp)"
TMP_UPLOAD="$(mktemp)"
TMP_DELETE_RAW="$(mktemp)"
TMP_DELETE="$(mktemp)"
TMP_KEY_FILES=()
cleanup() {
  rm -f "$TMP_ALL" "$TMP_UPLOAD" "$TMP_DELETE_RAW" "$TMP_DELETE"
  for f in "${TMP_KEY_FILES[@]+"${TMP_KEY_FILES[@]}"}"; do
    [[ -n "$f" ]] && rm -f "$f"
  done
}
trap cleanup EXIT

# ---------- Resolver llave SSH por servidor ----------
resolve_ssh_key() {
  local key_var="${1:-}"
  local content path tmp

  if [[ -n "$key_var" ]]; then
    content="${!key_var:-}"
    if [[ -n "$content" ]]; then
      tmp="$(mktemp)"
      printf '%s\n' "$content" > "$tmp"
      chmod 600 "$tmp"
      TMP_KEY_FILES+=("$tmp")
      printf '%s' "$tmp"
      return 0
    fi
    err "El servidor pide la llave '$key_var' pero la variable está vacía o no existe"
    return 1
  fi

  if [[ -n "${SSH_PRIVATE_KEY_PATH:-}" ]]; then
    path="$SSH_PRIVATE_KEY_PATH"
    [[ -f "$path" ]] || { err "SSH_PRIVATE_KEY_PATH no existe: $path"; return 1; }
    printf '%s' "$path"
    return 0
  fi

  if [[ -n "${SSH_PRIVATE_KEY:-}" ]]; then
    tmp="$(mktemp)"
    printf '%s\n' "$SSH_PRIVATE_KEY" > "$tmp"
    chmod 600 "$tmp"
    TMP_KEY_FILES+=("$tmp")
    printf '%s' "$tmp"
    return 0
  fi

  err "No hay llave SSH disponible (ni por servidor ni global SSH_PRIVATE_KEY / SSH_PRIVATE_KEY_PATH)"
  return 1
}

# ---------- Archivos del rango ----------
git diff --name-only --diff-filter=ACMRTUXB "$BASE_COMMIT" "$HEAD_COMMIT" \
  | awk 'NF' | sort -u > "$TMP_ALL"

matches_ignore() {
  local file="$1" pattern dir
  for pattern in "${IGNORE_PATTERNS[@]}"; do
    if [[ "$pattern" == */ ]]; then
      dir="${pattern%/}"
      [[ "$file" == "$dir"/* || "$file" == */"$dir"/* ]] && return 0
    fi
    [[ "$file" == $pattern ]] && return 0
    [[ "$(basename "$file")" == $pattern ]] && return 0
  done
  return 1
}

while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  [[ ! -f "$file" ]] && continue
  matches_ignore "$file" && continue
  echo "$file" >> "$TMP_UPLOAD"
done < "$TMP_ALL"

FILE_COUNT=0
if [[ -s "$TMP_UPLOAD" ]]; then
  FILE_COUNT="$(wc -l < "$TMP_UPLOAD" | tr -d ' ')"
fi

# ---------- Archivos eliminados del rango ----------
git diff --no-renames --name-only --diff-filter=D "$BASE_COMMIT" "$HEAD_COMMIT" \
  | awk 'NF' | sort -u > "$TMP_DELETE_RAW"

is_safe_relpath() {
  local p="$1"
  [[ -z "$p" ]] && return 1
  [[ "$p" == /* ]] && return 1
  [[ "$p" == *..* ]] && return 1
  [[ "$p" == .git/* ]] && return 1
  return 0
}

while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  matches_ignore "$file" && continue
  is_safe_relpath "$file" || { err "Path inseguro en delete list, descartado: $file"; continue; }
  echo "$file" >> "$TMP_DELETE"
done < "$TMP_DELETE_RAW"

DELETE_COUNT=0
if [[ -s "$TMP_DELETE" ]]; then
  DELETE_COUNT="$(wc -l < "$TMP_DELETE" | tr -d ' ')"
fi

# ---------- Header ----------
banner "RELEASE [$ENV_LABEL] — target '$TARGET' (rama '${BRANCH:-?}')"
log "Target         : $TARGET"
log "Branch         : ${BRANCH:-<desconocida>}"
log "Environment    : $ENV_LABEL"
log "Server count   : ${#SERVERS[@]}"
for entry in "${SERVERS[@]}"; do
  IFS='|' read -r _h _p _u _rp _kv <<< "$entry"
  log "  - $_u@$_h:$_p -> $_rp (key: ${_kv:-<global>})"
done
unset _h _p _u _rp _kv
log "Depth          : $DEPTH (HEAD~${DEPTH}..HEAD) [$DEPTH_SOURCE]"
log "Base commit    : $BASE_COMMIT"
log "Head commit    : $HEAD_COMMIT"
log "Config ignore  : $CONFIG_FILE"
log "Ignore count   : ${#IGNORE_PATTERNS[@]}"
log "Archivos subir : $FILE_COUNT"
log "Archivos borrar: $DELETE_COUNT"

if [[ "$FILE_COUNT" -eq 0 && "$DELETE_COUNT" -eq 0 ]]; then
  log "No hay archivos para desplegar ni eliminar."
  exit 0
fi

if [[ "$FILE_COUNT" -gt 0 ]]; then
  log "Lista de archivos a subir:"
  nl -ba "$TMP_UPLOAD" | sed 's/^/  /'
fi
if [[ "$DELETE_COUNT" -gt 0 ]]; then
  log "Lista de archivos a eliminar:"
  nl -ba "$TMP_DELETE" | sed 's/^/  /'
fi

# ---------- Deploy por servidor ----------
deploy_server() {
  local idx="$1" total="$2" entry="$3"
  local host port user remote_path key_var
  IFS='|' read -r host port user remote_path key_var <<< "$entry"

  server_banner "$idx" "$total" "$host"

  step "Paso 1/6: resolviendo llave SSH (${key_var:-<global>})"
  local key_file
  key_file="$(resolve_ssh_key "${key_var:-}")" \
    || die "[$host] No se pudo resolver llave SSH"
  step "        llave lista: $key_file"

  step "Paso 2/6: validando conectividad y detectando versión de rsync remoto"
  local remote_probe
  if ! remote_probe="$(ssh -i "$key_file" -p "$port" \
        -o StrictHostKeyChecking=accept-new \
        -o BatchMode=yes \
        -o ConnectTimeout=10 \
        "$user@$host" \
        'rsync --version 2>&1 | head -n1' \
        2>&1)"; then
    die "[$host] No se pudo conectar por SSH (revisar host/puerto/llave/permisos)"
  fi
  step "        conexión OK"

  local remote_rsync_ver
  remote_rsync_ver="$(printf '%s' "$remote_probe" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1 || true)"
  if [[ -z "$remote_rsync_ver" ]]; then
    err "[$host] No se pudo detectar la versión de rsync remoto (salida: $remote_probe)"
  elif version_ge "$remote_rsync_ver" "$MIN_RSYNC_VERSION"; then
    step "        rsync remoto: $remote_rsync_ver ✔ (>= $MIN_RSYNC_VERSION)"
  else
    err "[$host] rsync remoto $remote_rsync_ver < $MIN_RSYNC_VERSION (recomendado)"
    if [[ "$AUTO_UPDATE_RSYNC" == "1" ]]; then
      step "        AUTO_UPDATE_RSYNC=1 → intentando actualizar rsync con sudo"
      local update_script='
set -e
if command -v dnf >/dev/null 2>&1; then
  sudo -n dnf install -y rsync
elif command -v yum >/dev/null 2>&1; then
  sudo -n yum install -y rsync
elif command -v apt-get >/dev/null 2>&1; then
  sudo -n apt-get update -qq && sudo -n apt-get install -y rsync
else
  echo "NO_PKG_MANAGER" >&2
  exit 1
fi
rsync --version 2>&1 | head -n1
'
      local update_out
      if update_out="$(ssh -i "$key_file" -p "$port" \
              -o StrictHostKeyChecking=accept-new \
              -o BatchMode=yes \
              "$user@$host" "$update_script" 2>&1)"; then
        local new_ver
        new_ver="$(printf '%s' "$update_out" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1 || true)"
        step "        rsync actualizado a ${new_ver:-?}"
      else
        err "[$host] No se pudo actualizar rsync (sudo sin password / sin red / sin repos)"
        step "        continuando con rsync viejo"
      fi
    fi
  fi

  step "Paso 3/6: preparando parámetros de despliegue"
  step "        host   : $host"
  step "        user   : $user"
  step "        port   : $port"
  step "        remote : $remote_path"
  step "        key    : ${key_var:-<global>}"
  step "        subir  : $FILE_COUNT"
  step "        borrar : $DELETE_COUNT"

  step "Paso 4/6: ejecutando rsync (modo atómico: --delay-updates)"
  local ssh_cmd="ssh -i $key_file -p $port -o StrictHostKeyChecking=accept-new -o BatchMode=yes"
  local start_ts end_ts
  start_ts="$(date +%s)"
  if [[ "$FILE_COUNT" -gt 0 ]]; then
    local dirs_list
    dirs_list="$(awk -F/ 'NF>1{$NF=""; sub(/\/$/, ""); print}' OFS=/ "$TMP_UPLOAD" | sort -u)"
    if [[ -n "$dirs_list" ]]; then
      local mkdir_cmd=""
      while IFS= read -r d; do
        mkdir_cmd="${mkdir_cmd}sudo mkdir -p '${remote_path}/${d}' && sudo chown ${user}:${user} '${remote_path}/${d}' ; "
      done <<< "$dirs_list"
      ssh -i "$key_file" -p "$port" -o StrictHostKeyChecking=accept-new -o BatchMode=yes \
        "$user@$host" "bash -c '${mkdir_cmd} true'" 2>/dev/null || true
    fi

    rsync -rvz --omit-dir-times --no-perms --no-owner --no-group --chmod=a=rwx \
      --delay-updates \
      --files-from="$TMP_UPLOAD" \
      -e "$ssh_cmd" \
      "$REPO_ROOT/" "$user@$host:$remote_path/"
  else
    step "        nada para subir (solo deletes en este rango)"
  fi
  end_ts="$(date +%s)"

  step "Paso 5/6: eliminando archivos removidos en el rango"
  if [[ "$DELETE_COUNT" -eq 0 ]]; then
    step "        nada que eliminar"
  else
    step "        $DELETE_COUNT archivo(s) a eliminar"
    if ! ( while IFS= read -r _rel; do
             [[ -n "$_rel" ]] && printf '%s\0' "$remote_path/$_rel"
           done < "$TMP_DELETE" ) \
         | ssh -i "$key_file" -p "$port" \
             -o StrictHostKeyChecking=accept-new \
             -o BatchMode=yes \
             "$user@$host" 'xargs -0 -r rm -f --'; then
      err "[$host] Aviso: algunos archivos no se pudieron eliminar (permisos o ya borrados)"
    fi
    step "        eliminación OK"
  fi

  step "Paso 6/6: finalizado ($((end_ts - start_ts))s)"
  log "[$host] ✔ OK"
}

TOTAL_SERVERS="${#SERVERS[@]}"
IDX=0
for entry in "${SERVERS[@]}"; do
  IDX=$((IDX + 1))
  deploy_server "$IDX" "$TOTAL_SERVERS" "$entry"
done

banner "RELEASE [$ENV_LABEL] COMPLETADO — $TOTAL_SERVERS srv, $FILE_COUNT sub, $DELETE_COUNT del"
