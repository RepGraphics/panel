#!/usr/bin/env bash
# XyraPanel — shared helper

RESET=$'\033[0m'; BOLD=$'\033[1m'; DIM=$'\033[2m'
RB=$'\033[91m'; RED=$'\033[31m'; WHITE=$'\033[97m'
GRAY=$'\033[90m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'
export DIVIDER="${DIM}$(printf '─%.0s' {1..58})${RESET}"

log_info()    { echo -e "  ${GRAY}ℹ${RESET}  $*"; }
log_success() { echo -e "  ${GREEN}✔${RESET}  $*"; }
log_warn()    { echo -e "  ${YELLOW}⚠${RESET}  $*"; }
log_error()   { echo -e "  ${RB}✖${RESET}  $*" >&2; exit 1; }
log_start()   { echo -e "  ${GRAY}◌${RESET}  ${DIM}$*${RESET}"; }
log_step()    { echo -e "\n${RED}${BOLD}▶${RESET}${BOLD} $*${RESET}"; }

export -f log_info log_success log_warn log_error log_start log_step

# package manager helpers
pkg_update() {
  if [[ "${PKG_MANAGER}" == "apt" ]]; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
  else
    dnf makecache -q
  fi
}

pkg_install() {
  if [[ "${PKG_MANAGER}" == "apt" ]]; then
    apt-get install -y -qq "$@" 2>/dev/null
  else
    dnf install -y -q "$@"
  fi
}

export -f pkg_update pkg_install

# constants
export REPO_URL="https://github.com/XyraPanel/panel"
export INSTALL_DIR="/opt/xyrapanel"
export PANEL_USER="xyrapanel"
export NODE_VERSION="22"
export PG_VERSION="16"
export PNPM_BIN="/usr/local/bin/pnpm"