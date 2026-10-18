#!/usr/bin/env bash
#
# Build and run the ipyauth-pkce test container.
#
# The server-side PKCE token exchange sends the authorization code only to a
# trusted token endpoint. Google's endpoint is allowed by default; for any
# other provider (Keycloak/Auth0/localhost) set IPYAUTH_TOKEN_ENDPOINT to your
# provider's token endpoint. This script wires that env var into `podman run`.
#
# Usage:
#   dev/run-test.sh                        # uses the default endpoint below
#   dev/run-test.sh "https://kc/.../token" # override the token endpoint
#   IPYAUTH_TOKEN_ENDPOINT="https://..." dev/run-test.sh   # via env var
#   SKIP_BUILD=1 dev/run-test.sh           # reuse the existing image/wheel
#   VENV=.venv-other dev/run-test.sh       # Python venv to build with (default .venv)

set -euo pipefail

cd "$(dirname "$0")/.."

IMAGE="localhost/ipyauth-pkce:local"
PORT="${PORT:-8888}"

# Resolve the token endpoint: CLI arg > env var > default.
DEFAULT_ENDPOINT="http://localhost:8080/realms/myrealm/protocol/openid-connect/token"
TOKEN_ENDPOINT="${1:-${IPYAUTH_TOKEN_ENDPOINT:-$DEFAULT_ENDPOINT}}"

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
    echo ">> Rebuilding the JS bundle and the wheel (so the container tests current source)..."
    rm -f dist/ipyauth_pkce-*.whl dist/ipyauth_pkce-*.tar.gz
    # The wheel build reuses an existing bundle, so rebuild it explicitly first.
    # Use the local venv's tools directly (no network needed to bootstrap an
    # isolated build environment): it needs hatch-vcs, hatch-jupyter-builder
    # and jupyter-builder installed.
    if [[ ! -x "${VENV:-.venv}/bin/python" ]]; then
        echo "Python venv not found at ${VENV:-.venv} (see README Development; set VENV=...)" >&2
        exit 1
    fi
    VENV_BIN="$(cd "${VENV:-.venv}" && pwd)/bin"
    ( cd ipyauth_pkce/js && PATH="${VENV_BIN}:${PATH}" npm run build )
    "${VENV_BIN}/python" -m hatchling build -d dist

    echo ">> Building image ${IMAGE}..."
    podman build -f dev/Dockerfile.test -t "${IMAGE}" .
fi

echo ">> Token endpoint: ${TOKEN_ENDPOINT}"
echo ">> Starting container on http://localhost:${PORT}/ ..."
exec podman run --rm -p "${PORT}:8888" \
    -e IPYAUTH_TOKEN_ENDPOINT="${TOKEN_ENDPOINT}" \
    "${IMAGE}" start-notebook.py
