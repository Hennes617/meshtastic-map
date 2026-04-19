#!/bin/sh

set -eu

sh /app/docker/prisma.sh

echo "Starting map ui"
exec node src/index.js ${MAP_OPTS}
