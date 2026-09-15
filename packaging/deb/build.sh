#!/usr/bin/env bash
# Empacota o Wisp como .deb para Debian/Ubuntu, espelhando packaging/arch/PKGBUILD.
# Roda a partir do próprio repositório atual (não depende de tarball).
#
# Uso: packaging/deb/build.sh
# Saída: packaging/deb/wisp_<VERSION>_amd64.deb (ver VERSION abaixo)
#
# COMPATIBILIDADE WEBKIT — LEIA ANTES DE INSTALAR EM OUTRA DISTRO:
# O Wisp é buildado com a tag `webkit2_41` (ver README.md), ou seja, ele
# linka contra webkit2gtk-4.1. Debian/Ubuntu mais antigos só têm o pacote
# `libwebkit2gtk-4.0-37` (API 4.0) — este .deb declara
# `Depends: libwebkit2gtk-4.1-0` e NÃO vai instalar/funcionar neles.
# Distros suportadas: Debian 12 (bookworm)+, Ubuntu 22.04+ (têm 4.1).
set -euo pipefail

PKGNAME="wisp"
# ~beta1 (não -beta1): convenção de versionamento Debian pra pre-release —
# "~" ordena ANTES da versão final na comparação dpkg (0.1.0~beta1 < 0.1.0),
# hífen seria interpretado como separador do debian_revision.
VERSION="0.1.0~beta2"
ARCH="amd64"
MAINTAINER="Matheus Dutra <matheusbbdutra@gmail.com>"
DEB_FILE="${PKGNAME}_${VERSION}_${ARCH}.deb"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
STAGE_DIR="${SCRIPT_DIR}/stage"
BINARIO_BUILDADO="${REPO_ROOT}/build/bin/wisp"

# wails CLI pode estar fora do PATH (ex.: ~/go/bin) — igual ao PKGBUILD,
# que instala a CLI isolada no diretório de build.
if ! command -v wails >/dev/null 2>&1; then
  if [ -x "${HOME}/go/bin/wails" ]; then
    export PATH="${HOME}/go/bin:${PATH}"
  fi
fi
if ! command -v wails >/dev/null 2>&1; then
  echo "wails CLI não encontrada. Instale com:" >&2
  echo "  go install github.com/wailsapp/wails/v2/cmd/wails@v2.16.0" >&2
  exit 1
fi

command -v dpkg-deb >/dev/null 2>&1 || {
  echo "dpkg-deb não encontrado (Debian/Ubuntu: apt install dpkg-dev)." >&2
  exit 1
}

cd "${REPO_ROOT}"

# Mesmo build do PKGBUILD. -trimpath evita embutir o caminho absoluto de
# build no binário (problema real já corrigido no PKGBUILD do Arch).
wails build -tags webkit2_41 -clean -trimpath

[ -x "${BINARIO_BUILDADO}" ] || {
  echo "Binário esperado não encontrado: ${BINARIO_BUILDADO}" >&2
  exit 1
}

rm -rf "${STAGE_DIR}"
mkdir -p \
  "${STAGE_DIR}/DEBIAN" \
  "${STAGE_DIR}/usr/bin" \
  "${STAGE_DIR}/usr/share/applications" \
  "${STAGE_DIR}/usr/share/icons/hicolor/1024x1024/apps"

install -Dm755 "${BINARIO_BUILDADO}" "${STAGE_DIR}/usr/bin/wisp"
install -Dm644 "${REPO_ROOT}/packaging/assets/wisp.desktop" "${STAGE_DIR}/usr/share/applications/wisp.desktop"
install -Dm644 "${REPO_ROOT}/build/appicon.png" "${STAGE_DIR}/usr/share/icons/hicolor/1024x1024/apps/wisp.png"

cat > "${STAGE_DIR}/DEBIAN/control" <<CONTROL
Package: ${PKGNAME}
Version: ${VERSION}
Architecture: ${ARCH}
Maintainer: ${MAINTAINER}
Depends: libwebkit2gtk-4.1-0, libgtk-3-0
Description: Cliente SQL desktop leve e nativo (Go + Wails, PostgreSQL e SQLite)
 Wisp é um cliente SQL desktop leve: backend em Go (Wails) com
 interface em React + Monaco Editor, suporte a PostgreSQL e SQLite.
 .
 Requer webkit2gtk-4.1 (buildado com a tag webkit2_41); não funciona em
 distros que só oferecem libwebkit2gtk-4.0 (Debian 11 e anteriores,
 Ubuntu 20.04 e anteriores).
CONTROL

dpkg-deb --build --root-owner-group "${STAGE_DIR}" "${SCRIPT_DIR}/${DEB_FILE}"
rm -rf "${STAGE_DIR}"

echo "Pacote gerado: packaging/deb/${DEB_FILE}"
