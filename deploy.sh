#!/bin/bash
# Mergea tavo-dev en main y despliega a producción via Coolify

set -e

CURRENT=$(git rev-parse --abbrev-ref HEAD)

echo "→ Asegurando que tavo-dev está al día..."
git checkout tavo-dev
git pull origin tavo-dev

echo "→ Cambiando a main..."
git checkout main
git pull origin main

echo "→ Mergeando tavo-dev en main..."
git merge tavo-dev --no-edit

echo "→ Subiendo main a GitHub (esto dispara el deploy en Coolify)..."
git push origin main

echo "→ Volviendo a tavo-dev..."
git checkout tavo-dev

echo ""
echo "✅ Listo. El deploy en Coolify arranca en segundos."
