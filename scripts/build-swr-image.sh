#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DOCKER_BIN="${DOCKER_BIN:-docker}"
if [[ "${USE_SUDO:-}" == "1" ]]; then
  DOCKER_BIN="sudo docker"
fi

SWR_REGISTRY="${SWR_REGISTRY:-swr.cn-north-4.myhuaweicloud.com}"
SWR_NAMESPACE="${SWR_NAMESPACE:-ptzx-devops}"
IMAGE_NAME="${IMAGE_NAME:-kanna}"
PLATFORM="${PLATFORM:-linux/arm64}"
VERSION="${1:-$(date +%Y%m%d-%H%M%S)}"

LOCAL_IMAGE="${IMAGE_NAME}:${VERSION}"
SWR_IMAGE="${SWR_REGISTRY}/${SWR_NAMESPACE}/${IMAGE_NAME}:${VERSION}"

echo "==> Build ${LOCAL_IMAGE} (${PLATFORM})"
${DOCKER_BIN} buildx build \
  --platform "${PLATFORM}" \
  --provenance=false \
  -t "${LOCAL_IMAGE}" \
  --load \
  -f Dockerfile \
  .

echo "==> Tag ${SWR_IMAGE}"
${DOCKER_BIN} tag "${LOCAL_IMAGE}" "${SWR_IMAGE}"

echo "==> Push ${SWR_IMAGE}"
${DOCKER_BIN} push "${SWR_IMAGE}"

echo ""
echo "Build and push complete."
echo "  local: ${LOCAL_IMAGE}"
echo "  swr:   ${SWR_IMAGE}"
echo ""
echo "Production compose:"
echo "  export KANNA_IMAGE=${SWR_IMAGE}"
