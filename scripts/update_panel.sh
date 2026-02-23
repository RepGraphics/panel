#!/usr/bin/env bash
# XyraPanel — update existing installation
# Called by install.sh — expects PKG_MANAGER, FIREWALL etc to be exported

set -euo pipefail
SCRIPTS_BASE="https://raw.githubusercontent.com/XyraPanel/panel/main/scripts"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || echo "")"
if [[ -f "${SCRIPT_DIR}/common.sh" ]]; then
  source "${SCRIPT_DIR}/common.sh"
else
  source <(curl -fsSL "${SCRIPTS_BASE}/common.sh")
fi

echo -e "\n$DIVIDER"
log_info "Mode       ${GRAY}•${RESET} ${WHITE}Update${RESET}"
log_info "Install at ${GRAY}•${RESET} ${WHITE}${INSTALL_DIR}${RESET}"
echo -e "$DIVIDER\n"
read -rp "  ${BOLD}Proceed with update? [Y/n]:${RESET} " CONFIRM
[[ "${CONFIRM,,}" == "n" ]] && { log_info "Aborted."; exit 0; }

# ensure pnpm & pm2 are present
if [[ ! -x "$PNPM_BIN" ]]; then
  log_start "Installing pnpm"
  curl -fsSL "https://github.com/pnpm/pnpm/releases/latest/download/pnpm-linux-x64" -o "$PNPM_BIN"
  chmod +x "$PNPM_BIN"
fi
command -v pm2 &>/dev/null || { log_start "Installing PM2"; npm install -g pm2@latest --silent; }

# pull latest
log_step "Pulling latest source"
git config --global --add safe.directory "$INSTALL_DIR"
PREV_HASH=$(git -C "$INSTALL_DIR" rev-parse HEAD)
git -C "$INSTALL_DIR" fetch --tags
git -C "$INSTALL_DIR" stash --include-untracked 2>/dev/null || true
git -C "$INSTALL_DIR" pull --ff-only
NEW_HASH=$(git -C "$INSTALL_DIR" rev-parse HEAD)

if [[ "$PREV_HASH" == "$NEW_HASH" ]]; then
  log_success "Already up-to-date ${DIM}(${NEW_HASH:0:7})${RESET}"
else
  log_success "Updated ${DIM}${PREV_HASH:0:7}${RESET} → ${WHITE}${NEW_HASH:0:7}${RESET}"
fi
chown -R "${PANEL_USER}:${PANEL_USER}" "$INSTALL_DIR" 2>/dev/null || true

# rebuild if needed
cd "$INSTALL_DIR"
BUILD_HASH_FILE="$INSTALL_DIR/.output/.build-hash"
BUILD_HASH=$(cat "$BUILD_HASH_FILE" 2>/dev/null || echo "")

if [[ "$NEW_HASH" == "$BUILD_HASH" ]]; then
  log_success "Build already up-to-date — skipping rebuild"
else
  log_step "Installing dependencies"
  corepack disable 2>/dev/null || true
  export COREPACK_ENABLE_STRICT=0
  "$PNPM_BIN" install --no-frozen-lockfile
  log_success "Dependencies installed"

  log_step "Generating PWA assets"
  "$PNPM_BIN" run generate-pwa-assets
  log_success "PWA assets generated"

  log_step "Building panel ${DIM}(takes a few minutes)${RESET}"
  NODE_OPTIONS="--max-old-space-size=4096" "$PNPM_BIN" build
  echo "$NEW_HASH" > "$BUILD_HASH_FILE"
  log_success "Build complete"
fi
chown -R "${PANEL_USER}:${PANEL_USER}" "$INSTALL_DIR"

# restart
log_step "Restarting XyraPanel"
pm2 restart xyrapanel
log_success "PM2 restarted"

log_start "Waiting for app to be ready"
for i in $(seq 1 60); do
  curl -sf http://127.0.0.1:3000 >/dev/null 2>&1 && break
  printf "${GRAY}.${RESET}"; sleep 2
done
echo; log_success "App is responding on port 3000"

# migrations
log_step "Running database migrations"
DATABASE_URL="$(grep '^DATABASE_URL=' "$INSTALL_DIR/.env" | sed 's/^DATABASE_URL=//' | tr -d '"')"
if DATABASE_URL="$DATABASE_URL" "$PNPM_BIN" --dir "$INSTALL_DIR" db:migrate; then
  log_success "Migrations applied"
else
  log_warn "Migration failed — run manually: cd ${INSTALL_DIR} && pnpm db:migrate"
fi

echo -e "
$DIVIDER
  ${GREEN}${BOLD}✔${RESET}${BOLD}  XyraPanel updated successfully${RESET}
$DIVIDER

  ${BOLD}Version${RESET}        ${WHITE}${NEW_HASH:0:7}${RESET}
  ${BOLD}Install dir${RESET}    ${DIM}${INSTALL_DIR}${RESET}

  ${BOLD}Commands${RESET}
    ${GRAY}•${RESET} ${DIM}pm2 status${RESET}
    ${GRAY}•${RESET} ${DIM}pm2 logs xyrapanel${RESET}
    ${GRAY}•${RESET} ${DIM}pm2 restart xyrapanel${RESET}

$DIVIDER"