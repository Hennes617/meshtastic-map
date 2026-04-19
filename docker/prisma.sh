#!/bin/sh

set -eu

MODE="${1:-apply}"

echo "Generating Prisma client"
npx prisma generate

case "$MODE" in
  apply)
    echo "Syncing Prisma schema with db push"
    npx prisma db push --skip-generate
    ;;
  wait)
    echo "Waiting for Prisma schema to become available"
    attempt=0
    until node - <<'JS'
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

(async () => {
    let exitCode = 0;
    try {
        await prisma.node.count();
    } catch (err) {
        exitCode = 1;
    } finally {
        try {
            await prisma.$disconnect();
        } catch (err) {}
    }
    process.exit(exitCode);
})();
JS
    do
      attempt=$((attempt + 1))
      if [ "$attempt" -ge 60 ]; then
        echo "Timed out waiting for Prisma schema" >&2
        exit 1
      fi
      sleep 2
    done
    ;;
  *)
    echo "Unknown prisma startup mode: $MODE" >&2
    exit 1
    ;;
esac
