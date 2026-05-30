#!/bin/bash
set -e

npm install --no-audit --no-fund
npx prisma migrate deploy
npx prisma generate
# Mark generated Prisma client as ESM so Playwright/Node can import it.
mkdir -p src/generated/prisma
printf '{"type":"module"}\n' > src/generated/prisma/package.json

# Drift check: fail if schema.prisma defines models/columns/indexes that no
# migration creates. Exit code 2 means drift was detected (issue #48).
if ! npm run -s db:check-drift; then
  echo ""
  echo "ERROR: Drift detectado entre prisma/schema.prisma y las migraciones."
  echo "Corre 'npx prisma migrate dev --name <descripcion>' y commitea la nueva migracion."
  exit 1
fi
