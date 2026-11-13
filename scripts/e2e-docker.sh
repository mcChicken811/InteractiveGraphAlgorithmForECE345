#!/bin/sh
# Builds the Playwright image and runs the browser tests inside it.
# Extra arguments are passed to `playwright test`, e.g.:
#   npm run test:e2e -- --grep "edge"
set -eu
cd "$(dirname "$0")/.."

IMAGE=bfs-graph-builder-e2e

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker Desktop and try again." >&2
  exit 1
fi

docker build --quiet -f docker/playwright.Dockerfile -t "$IMAGE" . >/dev/null

mkdir -p test-results
# --network none: the tests only talk to the Vite server inside the container.
# Only test-results/ is shared with the host, so traces/screenshots from failures are visible.
exec docker run --rm --init \
  --network none \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --shm-size 1g \
  -v "$PWD/test-results:/home/pwuser/app/test-results" \
  "$IMAGE" "$@"
