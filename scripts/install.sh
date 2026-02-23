#!/usr/bin/env bash
# XyraPanel — installer entry point
# bash <(curl -fsSL https://raw.githubusercontent.com/XyraPanel/panel/main/scripts/install.sh)

set -euo pipefail

SCRIPTS_BASE="https://raw.githubusercontent.com/XyraPanel/panel/main/scripts"
INSTALL_DIR="/opt/xyrapanel"

RESET=$'\033[0m'; BOLD=$'\033[1m'; DIM=$'\033[2m'
RB=$'\033[91m'; RED=$'\033[31m'; WHITE=$'\033[97m'
GRAY=$'\033[90m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'
DIVIDER="${DIM}$(printf '─%.0s' {1..58})${RESET}"

log_info()  { echo -e "  ${GRAY}ℹ${RESET}  $*"; }
log_error() { echo -e "  ${RB}✖${RESET}  $*" >&2; exit 1; }

# root check
[[ $EUID -ne 0 ]] && log_error "Run as root or with sudo."

# detect distro
[[ ! -f /etc/os-release ]] && log_error "Cannot detect OS — /etc/os-release not found."
source /etc/os-release
OS_ID="${ID,,}"
OS_VER="${VERSION_ID}"
OS_MAJOR="${VERSION_ID%%.*}"

export OS_ID OS_VER OS_MAJOR PRETTY_NAME

case "$OS_ID" in
  ubuntu)
    [[ "$OS_VER" == "22.04" || "$OS_VER" == "24.04" ]] || \
      echo -e "  ${YELLOW}⚠${RESET}  Untested Ubuntu ${OS_VER} — officially supported: 22.04, 24.04"
    export PKG_MANAGER="apt" FIREWALL="ufw"
    ;;
  debian)
    [[ "$OS_MAJOR" == "11" || "$OS_MAJOR" == "12" ]] || \
      echo -e "  ${YELLOW}⚠${RESET}  Untested Debian ${OS_VER} — officially supported: 11, 12"
    export PKG_MANAGER="apt" FIREWALL="ufw"
    ;;
  almalinux|rocky|rhel|centos)
    [[ "$OS_MAJOR" == "8" || "$OS_MAJOR" == "9" ]] || \
      echo -e "  ${YELLOW}⚠${RESET}  Untested RHEL-family ${OS_VER} — officially supported: 8, 9"
    export PKG_MANAGER="dnf" FIREWALL="firewalld"
    ;;
  *)
    log_error "Unsupported OS: ${OS_ID}. Supported: Ubuntu 22/24, Debian 11/12, AlmaLinux 8/9."
    ;;
esac

# ram check
TOTAL_RAM_MB=$(awk '/MemTotal/{printf "%d",$2/1024}' /proc/meminfo)
(( TOTAL_RAM_MB < 512 )) && log_error "Insufficient RAM: ${TOTAL_RAM_MB}MB (min 512MB)."
export TOTAL_RAM_MB

# banner
echo -e "
${RB}${BOLD}██╗  ██╗ ██╗   ██╗ ██████╗  █████╗ ██████╗  █████╗ ███╗   ██╗███████╗██╗${RESET}  ${DIM}Panel Manager${RESET}
${RB}${BOLD}╚██╗██╔╝ ╚██╗ ██╔╝ ██╔══██╗██╔══██╗██╔══██╗██╔══██╗████╗  ██║██╔════╝██║${RESET}  ${DIM}by @26bz & contributors${RESET}
${RB}${BOLD} ╚███╔╝   ╚████╔╝  ██████╔╝███████║██████╔╝███████║██╔██╗ ██║█████╗  ██║${RESET}
${RB}${BOLD} ██╔██╗    ╚██╔╝   ██╔══██╗██╔══██║██╔═══╝ ██╔══██║██║╚██╗██║██╔══╝  ██║${RESET}
${RB}${BOLD}██╔╝ ██╗    ██║    ██║  ██║██║  ██║██║     ██║  ██║██║ ╚████║███████╗███████╗${RESET}
${RB}${BOLD}╚═╝  ╚═╝    ╚═╝    ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝╚══════╝${RESET}
$DIVIDER
  ${DIM}Distro   ${RESET}${WHITE}${PRETTY_NAME}${RESET}
$DIVIDER"

# menu
EXISTING=false
[[ -d "$INSTALL_DIR/.git" && -f "$INSTALL_DIR/.env" ]] && EXISTING=true

echo ""
if [[ "$EXISTING" == "true" ]]; then
  CURRENT_VER=$(git -C "$INSTALL_DIR" describe --tags --always 2>/dev/null || echo "unknown")
  echo -e "  ${YELLOW}${BOLD}Existing installation detected${RESET} ${DIM}(${CURRENT_VER})${RESET}\n"
  echo -e "  ${WHITE}[1]${RESET} ${BOLD}Update${RESET}       ${DIM}Pull latest, rebuild, run migrations — keeps .env${RESET}"
  echo -e "  ${WHITE}[2]${RESET} ${BOLD}Reinstall${RESET}    ${DIM}Wipe and do a clean install${RESET}"
  echo -e "  ${WHITE}[3]${RESET} ${BOLD}Uninstall${RESET}    ${DIM}Remove XyraPanel completely${RESET}"
  echo -e "  ${WHITE}[4]${RESET} ${BOLD}Abort${RESET}        ${DIM}Exit without changes${RESET}"
  echo ""
  read -rp "  ${BOLD}Choice [1-4]:${RESET} " CHOICE
  case "$CHOICE" in
    1) ACTION="update"    ;;
    2) ACTION="install"   ;;
    3) ACTION="uninstall" ;;
    4) echo -e "\n  Aborted."; exit 0 ;;
    *) log_error "Invalid choice." ;;
  esac
else
  echo -e "  ${WHITE}[1]${RESET} ${BOLD}Install${RESET}      ${DIM}Fresh installation${RESET}"
  echo -e "  ${WHITE}[2]${RESET} ${BOLD}Abort${RESET}        ${DIM}Exit without changes${RESET}"
  echo ""
  read -rp "  ${BOLD}Choice [1-2]:${RESET} " CHOICE
  case "$CHOICE" in
    1) ACTION="install" ;;
    2) echo -e "\n  Aborted."; exit 0 ;;
    *) log_error "Invalid choice." ;;
  esac
fi

# fetch and run the selected sub-script
# when running from a local clone, use sibling scripts in the same directory
# when piped from curl, fetch sub-scripts remotely
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || echo "")"

run_script() {
  local name="$1"; shift
  local local_path="${SCRIPT_DIR}/${name}.sh"
  if [[ -f "$local_path" ]]; then
    bash "$local_path" "$@"
  else
    bash <(curl -fsSL "${SCRIPTS_BASE}/${name}.sh") "$@"
  fi
}

case "$ACTION" in
  install)   run_script "install_panel"   ;;
  update)    run_script "update_panel"    ;;
  uninstall) run_script "uninstall_panel" ;;
esac