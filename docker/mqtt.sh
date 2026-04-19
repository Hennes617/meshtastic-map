#!/bin/sh

set -eu

DEFAULT_PROTOBUF_PATHS="
/app/src/external/protobufs
/app/external/protobufs
/app/protobufs
"

AUTO_FETCH_PROTOBUFS="${AUTO_FETCH_PROTOBUFS:-true}"
PROTOBUFS_REPO_URL="${PROTOBUFS_REPO_URL:-https://github.com/meshtastic/protobufs}"
PROTOBUFS_GIT_REF="${PROTOBUFS_GIT_REF:-}"
PROTOBUFS_CLONE_PATH="${PROTOBUFS_CLONE_PATH:-/app/src/external/protobufs}"

is_truthy() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on)
      return 0
      ;;
  esac
  return 1
}

append_protobuf_path() {
  MQTT_OPTS="${MQTT_OPTS:-} --protobufs-path $1"
}

find_default_protobufs() {
  for protobufs_path in $DEFAULT_PROTOBUF_PATHS; do
    protobuf_file="$protobufs_path/meshtastic/mqtt.proto"
    if [ -f "$protobuf_file" ]; then
      append_protobuf_path "$protobufs_path"
      echo "Using Meshtastic protobufs from $protobufs_path"
      return 0
    fi
  done
  return 1
}

clone_default_protobufs() {
  target_path="$PROTOBUFS_CLONE_PATH"
  protobuf_file="$target_path/meshtastic/mqtt.proto"

  if [ -f "$protobuf_file" ]; then
    append_protobuf_path "$target_path"
    echo "Using Meshtastic protobufs from $target_path"
    return 0
  fi

  if [ -e "$target_path" ] && [ ! -d "$target_path/.git" ] && [ ! -f "$protobuf_file" ]; then
    echo "Meshtastic protobuf target path exists but is not a valid protobuf checkout: $target_path"
    return 1
  fi

  mkdir -p "$(dirname "$target_path")"

  if [ ! -d "$target_path/.git" ]; then
    echo "Meshtastic protobufs not found. Cloning from $PROTOBUFS_REPO_URL into $target_path"
    if [ -n "$PROTOBUFS_GIT_REF" ]; then
      git clone --depth 1 --branch "$PROTOBUFS_GIT_REF" "$PROTOBUFS_REPO_URL" "$target_path"
    else
      git clone --depth 1 "$PROTOBUFS_REPO_URL" "$target_path"
    fi
  else
    echo "Using existing Meshtastic protobuf checkout at $target_path"
  fi

  if [ ! -f "$protobuf_file" ]; then
    echo "Meshtastic protobuf checkout is missing $protobuf_file"
    return 1
  fi

  append_protobuf_path "$target_path"
  echo "Using Meshtastic protobufs from $target_path"
  return 0
}

has_custom_protobuf_path=false
if printf '%s' "${MQTT_OPTS:-}" | grep -q -- '--protobufs-path'; then
  has_custom_protobuf_path=true
fi

if [ "$has_custom_protobuf_path" = false ]; then
  find_default_protobufs || true
fi

if [ "$has_custom_protobuf_path" = false ] && ! printf '%s' "${MQTT_OPTS:-}" | grep -q -- '--protobufs-path'; then
  if is_truthy "$AUTO_FETCH_PROTOBUFS"; then
    clone_default_protobufs || true
  fi
fi

if [ "$has_custom_protobuf_path" = false ] && ! printf '%s' "${MQTT_OPTS:-}" | grep -q -- '--protobufs-path'; then
  echo "Meshtastic protobufs were not found in any default location:"
  for protobufs_path in $DEFAULT_PROTOBUF_PATHS; do
    echo " - $protobufs_path/meshtastic/mqtt.proto"
  done
  echo "Automatic fetch is ${AUTO_FETCH_PROTOBUFS}."
  echo "To enable the MQTT Collector manually, clone Meshtastic protobufs into src/external/protobufs:"
  echo "git clone https://github.com/meshtastic/protobufs src/external/protobufs"
  echo "Or set MQTT_OPTS with --protobufs-path to a custom protobuf location."
  exit 1
fi

echo "Running migrations"
npx prisma migrate dev

echo "Starting mqtt listener"
exec node src/mqtt.js ${MQTT_OPTS}
