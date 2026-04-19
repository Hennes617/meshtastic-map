#!/bin/sh

DEFAULT_PROTOBUF_PATHS="
/app/src/external/protobufs
/app/external/protobufs
/app/protobufs
"

has_custom_protobuf_path=false
if printf '%s' "${MQTT_OPTS:-}" | grep -q -- '--protobufs-path'; then
  has_custom_protobuf_path=true
fi

if [ "$has_custom_protobuf_path" = false ]; then
  for protobufs_path in $DEFAULT_PROTOBUF_PATHS; do
    protobuf_file="$protobufs_path/meshtastic/mqtt.proto"
    if [ -f "$protobuf_file" ]; then
      MQTT_OPTS="${MQTT_OPTS:-} --protobufs-path $protobufs_path"
      echo "Using Meshtastic protobufs from $protobufs_path"
      break
    fi
  done
fi

if [ "$has_custom_protobuf_path" = false ] && ! printf '%s' "${MQTT_OPTS:-}" | grep -q -- '--protobufs-path'; then
  echo "Skipping mqtt listener startup: Meshtastic protobufs were not found in any default location:"
  for protobufs_path in $DEFAULT_PROTOBUF_PATHS; do
    echo " - $protobufs_path/meshtastic/mqtt.proto"
  done
  echo "To enable the MQTT Collector, clone Meshtastic protobufs into src/external/protobufs:"
  echo "git clone https://github.com/meshtastic/protobufs src/external/protobufs"
  echo "Or set MQTT_OPTS with --protobufs-path to a custom protobuf location."
  exec tail -f /dev/null
fi

echo "Running migrations"
npx prisma migrate dev

echo "Starting mqtt listener"
exec node src/mqtt.js ${MQTT_OPTS}
