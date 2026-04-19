#!/bin/sh

PROTOBUF_FILE="/app/src/external/protobufs/meshtastic/mqtt.proto"

if [ ! -f "$PROTOBUF_FILE" ] && ! printf '%s' "${MQTT_OPTS:-}" | grep -q -- '--protobufs-path'; then
  echo "Skipping mqtt listener startup: Meshtastic protobufs were not found at $PROTOBUF_FILE"
  echo "To enable the MQTT Collector, clone Meshtastic protobufs into src/external/protobufs:"
  echo "git clone https://github.com/meshtastic/protobufs src/external/protobufs"
  echo "Or set MQTT_OPTS with --protobufs-path to a custom protobuf location."
  exec tail -f /dev/null
fi

echo "Running migrations"
npx prisma migrate dev

echo "Starting mqtt listener"
exec node src/mqtt.js ${MQTT_OPTS}
