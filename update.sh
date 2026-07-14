#!/bin/sh

set -eu

# Only accept a fast-forward update so local server changes are never merged silently.
git fetch --prune
git pull --ff-only

# Install the exact reviewed dependency set and regenerate the Prisma client.
npm ci
npx prisma generate

# sync prisma schema
sh ./docker/prisma.sh apply

# restart services
service meshtastic-map restart
service meshtastic-map-mqtt restart
