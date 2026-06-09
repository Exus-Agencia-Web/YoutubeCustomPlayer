#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# release.sh — despliegue incremental para GitHub Actions
#
# Uso:
#   bash scripts/release.sh <develop|production>
#
# Autenticación:
#   Solo por llave SSH. Cada servidor puede tener su propia llave
#   via el 5º campo del array (nombre de env var con el PEM).
#
# Opcional:
#   RELEASE_CONFIG   Ruta a JSON con array "ignore". Default .vscode/sftp.json
#   GH_BEFORE        SHA antes del push (github.event.before). Si está presente
#                    se usa como base del diff; si no, cae a HEAD~1.
# ============================================================

# Servidores para rama develop (desarrollo / staging)
DEVELOP_SERVERS=(
  "developers.pagegear.co|19840|ec2-user|/PageGearCloud/www/html/pge/dominios/YoutubeCustomPlayer|AWS1_SSH_KEY"
)

# Servidores para rama master (producción)
MASTER_SERVERS=(
  "cloud.pagegear.co|19840|ec2-user|/PageGearCloud/www/html/pge/dominios/YoutubeCustomPlayer|AWS1_SSH_KEY"
)

EXTRA_IGNORE_PATTERNS=(
  ".github/"
  ".vscode/"
  ".claude/"
  "docker/"
  "docs/"
)

MIN_RSYNC_VERSION="3.2.0"
AUTO_UPDATE_RSYNC=1

ts()   { date '+%H:%M:%S'; }
log()  { printf '[release %s] %s\n' "$(ts)" "$*"; }
err()  { printf '[release %s][ERROR] %s\n' "$(ts)" "$*" >&2; }
die()  { err "$*"; exit 1; }
step() { printf '[release %s]   → %s\n' "$(ts)" "$*"; }

banner() {
  local title="$1" line
  line="$(printf '%0.s=' {1..72})"
  printf '\n%s\n  %s\n%s\n' "$line" "$title" "$line"
}

server_banner() {
  local idx="$1" total="$2" host="$3" line
  line="$(printf '%0.s#' {1..72})"
  printf '\n%s\n#  [%d/%d] SERVIDOR: %s\n#  hora: %s\n%s\n' \
    "$line" "$idx" "$total" "$host" "$(date '+%Y-%m-%d %H:%M:%S')" "$line"
}

version_ge() {
  [[ "$1" == "$2" ]] && return 0
  local smaller
  smaller="$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -n1)"
  [[ "$smaller" == "$2" ]]
}

for cmd in git rsync ssh python3 awk sort mktemp dirname basename nl wc tr; do
  command -v "$cmd" >/dev/null 2>&1 || die "Falta dependencia: $cmd"
done

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[[ -n "$REPO_ROOT" ]] || die "No se encuentra repositorio git"
cd "$REPO_ROOT"

# ---------- Base commit ----------
# USE_GH_BEFORE activo → usa GH_BEFORE (commits exactos del PR)
# USE_GH_BEFORE vacío   → usa COMMITSDEPTH para la profundidad
HEAD_COMMIT="$(git rev-parse HEAD)"
NULL_SHA="0000000000000000000000000000000000000000"

if [[ -n "${USE_GH_BEFORE:-}" ]]; then
  if [[ -n "${GH_BEFORE:-}" && "$GH_BEFORE" != "$NULL_SHA" ]]; then
    BASE_COMMIT="$GH_BEFORE"
    BASE_SOURCE="GH_BEFORE (commits del PR)"
  else
    BASE_COMMIT="$(git rev-parse "HEAD~1")"
    BASE_SOURCE="fallback HEAD~1 (workflow_dispatch o primer push)"
  fi
else
  DEPTH="${COMMITSDEPTH:-1}"
  [[ "$DEPTH" =~ ^[1-9][0-9]*$ ]] \
    || die "COMMITSDEPTH debe ser entero positivo, recibido: '$DEPTH'"
  BASE_COMMIT="$(git rev-parse "HEAD~${DEPTH}")"
  BASE_SOURCE="COMMITSDEPTH=$DEPTH"
fi

log "Base commit: $BASE_COMMIT [$BASE_SOURCE]"
log "Head commit: $HEAD_COMMIT"

# ---------- Selección de servidores ----------
TARGET="${1:-}"
[[ -n "$TARGET" ]] || die "Falta argumento de ambiente. Uso: release.sh <develop|production>"

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

[[ "${#SERVERS[@]}" -gt 0 ]] || die "Array de servidores para '$TARGET' está vacío"
for entry in "${SERVERS[@]}"; do
  IFS='|' read -r _h _p _u _rp _kv <<< "$entry"
  [[ -n "${_h:-}" && -n "${_p:-}" && -n "${_u:-}" && -n "${_rp:-}" ]] \
    || die "Entrada SERVERS inválida: '$entry'"
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

resolve_ssh_key() {
  local key_var="${1:-}" content path tmp

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
    err "El servidor pide la llave '$key_var' pero la variable está vacía"
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

  err "No hay llave SSH disponible"
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
[[ -s "$TMP_UPLOAD" ]] && FILE_COUNT="$(wc -l < "$TMP_UPLOAD" | tr -d ' ')"

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
  is_safe_relpath "$file" || { err "Path inseguro descartado: $file"; continue; }
  echo "$file" >> "$TMP_DELETE"
done < "$TMP_DELETE_RAW"

DELETE_COUNT=0
[[ -s "$TMP_DELETE" ]] && DELETE_COUNT="$(wc -l < "$TMP_DELETE" | tr -d ' ')"

# ---------- Header ----------
banner "RELEASE [$ENV_LABEL] — target '$TARGET' (rama '${BRANCH:-?}')"
log "Target         : $TARGET"
log "Branch         : ${BRANCH:-<desconocida>}"
log "Base commit    : $BASE_COMMIT [$BASE_SOURCE]"
log "Head commit    : $HEAD_COMMIT"
log "Server count   : ${#SERVERS[@]}"
for entry in "${SERVERS[@]}"; do
  IFS='|' read -r _h _p _u _rp _kv <<< "$entry"
  log "  - $_u@$_h:$_p -> $_rp (key: ${_kv:-<global>})"
done
unset _h _p _u _rp _kv
log "Config ignore  : $CONFIG_FILE"
log "Archivos subir : $FILE_COUNT"
log "Archivos borrar: $DELETE_COUNT"

if [[ "$FILE_COUNT" -eq 0 && "$DELETE_COUNT" -eq 0 ]]; then
  log "No hay archivos para desplegar ni eliminar."
  exit 0
fi

[[ "$FILE_COUNT" -gt 0 ]] && { log "Archivos a subir:"; nl -ba "$TMP_UPLOAD" | sed 's/^/  /'; }
[[ "$DELETE_COUNT" -gt 0 ]] && { log "Archivos a eliminar:"; nl -ba "$TMP_DELETE" | sed 's/^/  /'; }

# ---------- Deploy ----------
deploy_server() {
  local idx="$1" total="$2" entry="$3"
  local host port user remote_path key_var
  IFS='|' read -r host port user remote_path key_var <<< "$entry"

  server_banner "$idx" "$total" "$host"

  step "Paso 1/6: resolviendo llave SSH (${key_var:-<global>})"
  local key_file
  key_file="$(resolve_ssh_key "${key_var:-}")" || die "[$host] No se pudo resolver llave SSH"
  step "        llave lista: $key_file"

  step "Paso 2/6: validando conectividad y versión rsync"
  local remote_probe
  if ! remote_probe="$(ssh -i "$key_file" -p "$port" \
        -o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=10 \
        "$user@$host" 'rsync --version 2>&1 | head -n1' 2>&1)"; then
    die "[$host] No se pudo conectar por SSH"
  fi
  step "        conexión OK"

  local remote_rsync_ver
  remote_rsync_ver="$(printf '%s' "$remote_probe" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1 || true)"
  if [[ -z "$remote_rsync_ver" ]]; then
    err "[$host] No se pudo detectar versión rsync"
  elif version_ge "$remote_rsync_ver" "$MIN_RSYNC_VERSION"; then
    step "        rsync $remote_rsync_ver ✔"
  else
    err "[$host] rsync $remote_rsync_ver < $MIN_RSYNC_VERSION"
    if [[ "$AUTO_UPDATE_RSYNC" == "1" ]]; then
      local update_script='
set -e
if command -v dnf >/dev/null 2>&1; then sudo -n dnf install -y rsync
elif command -v yum >/dev/null 2>&1; then sudo -n yum install -y rsync
elif command -v apt-get >/dev/null 2>&1; then sudo -n apt-get update -qq && sudo -n apt-get install -y rsync
else echo "NO_PKG_MANAGER" >&2; exit 1; fi
rsync --version 2>&1 | head -n1'
      local update_out
      if update_out="$(ssh -i "$key_file" -p "$port" -o StrictHostKeyChecking=accept-new \
            -o BatchMode=yes "$user@$host" "$update_script" 2>&1)"; then
        step "        rsync actualizado a $(printf '%s' "$update_out" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1 || echo '?')"
      else
        err "[$host] No se pudo actualizar rsync"
      fi
    fi
  fi

  step "Paso 3/6: parámetros — host:$host port:$port remote:$remote_path"
  step "Paso 4/6: rsync (--delay-updates)"
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
      --delay-updates --files-from="$TMP_UPLOAD" -e "$ssh_cmd" \
      "$REPO_ROOT/" "$user@$host:$remote_path/"
  else
    step "        nada para subir"
  fi
  end_ts="$(date +%s)"

  step "Paso 5/6: eliminando archivos del rango"
  if [[ "$DELETE_COUNT" -eq 0 ]]; then
    step "        nada que eliminar"
  else
    if ! ( while IFS= read -r _rel; do
             [[ -n "$_rel" ]] && printf '%s\0' "$remote_path/$_rel"
           done < "$TMP_DELETE" ) \
         | ssh -i "$key_file" -p "$port" -o StrictHostKeyChecking=accept-new \
             -o BatchMode=yes "$user@$host" 'xargs -0 -r rm -f --'; then
      err "[$host] Algunos archivos no se pudieron eliminar"
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
