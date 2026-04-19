#!/bin/sh

set -eu

echo "Generating Prisma client"
npx prisma generate

if find /app/prisma/migrations -mindepth 1 -maxdepth 1 -type d | grep -q .; then
  echo "Applying Prisma migrations"
  npx prisma migrate deploy
else
  echo "No Prisma migrations found, syncing schema with db push"
  npx prisma db push --skip-generate
fi
