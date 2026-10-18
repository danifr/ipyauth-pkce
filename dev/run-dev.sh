#!/usr/bin/env bash
#
# Fast inner-loop dev runner for ipyauth-pkce.
#
# Instead of rebuilding a wheel + image on every change (Dockerfile.test /
# run-test.sh, ~20-30s), this builds a dev image ONCE and bind-mounts your
# working tree into it. Iterating is then just a container restart:
#
#   - Python change  -> live via editable install; restart container (~2-3s)
#   - JS change      -> rebuild the labextension bundle, reload the browser
#
# NOTE: JupyterLab loads the labextension bundle in ipyauth_pkce/labextension
# (gitignored), built on the host from ipyauth_pkce/js/src. It is built
# automatically if missing; after JS edits rebuild it with --js or --watch.
#
# Usage (from anywhere; paths are resolved from the repo root):
#   dev/run-dev.sh                 # start (builds dev image on first run)
#   dev/run-dev.sh --js            # rebuild labextension bundle once, then start
#   dev/run-dev.sh --watch         # auto-rebuild labextension on src changes,
#                                #   then just reload the browser (no restart)
#   dev/run-dev.sh --rebuild       # force-rebuild the dev image
#   dev/run-dev.sh "https://kc/.../token"   # override the token endpoint
#
# Env:
#   PORT=8889 dev/run-dev.sh       # change host port (default 8888)
#   VENV=.venv-other dev/run-dev.sh  # Python venv to use (default .venv)

set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE="localhost/ipyauth-pkce:dev"
PORT="${PORT:-8888}"
DEFAULT_ENDPOINT="http://localhost:8080/realms/myrealm/protocol/openid-connect/token"
JS_DIR="ipyauth_pkce/js"
JS_SRC="${JS_DIR}/src"
# Python venv providing jupyter-builder for `npm run build` (override with VENV=...).
if [[ ! -x "${VENV:-.venv}/bin/python" ]]; then
    echo "Python venv not found at ${VENV:-.venv} (see README Development; set VENV=...)" >&2
    exit 1
fi
VENV_BIN="$(cd "${VENV:-.venv}" && pwd)/bin"

BUILD_JS=0
WATCH=0
FORCE_REBUILD=0
TOKEN_ENDPOINT_ARG=""

for arg in "$@"; do
    case "$arg" in
        --js) BUILD_JS=1 ;;
        --watch) WATCH=1 ; BUILD_JS=1 ;;
        --rebuild) FORCE_REBUILD=1 ;;
        *) TOKEN_ENDPOINT_ARG="$arg" ;;
    esac
done

TOKEN_ENDPOINT="${TOKEN_ENDPOINT_ARG:-${IPYAUTH_TOKEN_ENDPOINT:-$DEFAULT_ENDPOINT}}"

# Build the JupyterLab labextension bundle from ipyauth_pkce/js into
# ipyauth_pkce/labextension (bind-mounted, so the container sees it on reload).
build_labextension() {
    ( cd "${JS_DIR}" && PATH="${VENV_BIN}:${PATH}" npm run build )
}

if [[ ! -f ipyauth_pkce/labextension/package.json ]]; then
    BUILD_JS=1
fi

if [[ "${BUILD_JS}" == "1" ]]; then
    echo ">> Rebuilding labextension bundle (host)..."
    build_labextension
fi

# --watch: poll src/ mtimes and rebuild the labextension on change. Portable
# BSD/macOS stat (-f %m). Runs in the background while the container is up.
WATCH_PID=""
start_watcher() {
    echo ">> Watching ${JS_SRC} for changes (rebuild labextension on save)..."
    (
        latest_mtime() {
            # Newest mtime across all .js files under src (excluding __tests__).
            find "${JS_SRC}" -name '*.js' -not -path '*/__tests__/*' \
                -exec stat -f '%m' {} \; 2>/dev/null | sort -nr | head -1
        }
        last="$(latest_mtime)"
        while true; do
            sleep 2
            cur="$(latest_mtime)"
            if [[ "${cur}" != "${last}" ]]; then
                last="${cur}"
                echo ">> [watch] change detected — rebuilding labextension..."
                if build_labextension; then
                    echo ">> [watch] done. Reload your browser to pick up changes."
                else
                    echo ">> [watch] build failed — fix errors and save again." >&2
                fi
            fi
        done
    ) &
    WATCH_PID=$!
}

cleanup() {
    if [[ -n "${WATCH_PID}" ]] && kill -0 "${WATCH_PID}" 2>/dev/null; then
        kill "${WATCH_PID}" 2>/dev/null || true
    fi
}
trap cleanup EXIT INT TERM

# Build the dev image once (or when forced / missing).
if [[ "${FORCE_REBUILD}" == "1" ]] || ! podman image exists "${IMAGE}"; then
    echo ">> Building dev image ${IMAGE} (one-time / on demand)..."
    podman build -f dev/Dockerfile.dev -t "${IMAGE}" .
fi

if [[ "${WATCH}" == "1" ]]; then
    start_watcher
fi

echo ">> Token endpoint: ${TOKEN_ENDPOINT}"
echo ">> Starting dev container on http://localhost:${PORT}/ (no token, source bind-mounted)..."
echo ">> Open: http://localhost:${PORT}/lab"
# Bind-mount the package source over the image's copy so Python edits are live
# and the symlinked labextension resolves to freshly built host assets.
# Not exec'd (so the EXIT trap can stop the watcher when the container stops).
#
# Token/password auth is disabled for convenience: just open localhost:${PORT}.
# This is a LOCAL DEV container only — never expose it on a shared network.
podman run --rm -p "${PORT}:8888" \
    -e IPYAUTH_TOKEN_ENDPOINT="${TOKEN_ENDPOINT}" \
    -v "$(pwd)/ipyauth_pkce:/opt/ipyauth-src/ipyauth_pkce:Z" \
    "${IMAGE}" start-notebook.py \
    --IdentityProvider.token='' \
    --ServerApp.password='' \
    --ServerApp.disable_check_xsrf=False
