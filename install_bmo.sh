#!/usr/bin/env bash
# ============================================================
#  BMO — Instalador Universal v1.0
#  Detecta: Linux (debian/arch/fedora), macOS, Android (Termux)
#  Para Windows: usa install_bmo.ps1
#  Ruben © 2026
# ============================================================

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

ok()   { echo -e "${GREEN}✅ $*${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $*${NC}"; }
err()  { echo -e "${RED}❌ $*${NC}"; exit 1; }
info() { echo -e "${CYAN}ℹ️  $*${NC}"; }
sep()  { echo -e "${BOLD}─────────────────────────────────────────${NC}"; }

clear
echo -e "${BOLD}${CYAN}"
cat << 'BANNER'
  ██████╗ ███╗   ███╗ ██████╗
  ██╔══██╗████╗ ████║██╔═══██╗
  ██████╔╝██╔████╔██║██║   ██║
  ██╔══██╗██║╚██╔╝██║██║   ██║
  ██████╔╝██║ ╚═╝ ██║╚██████╔╝
  ╚═════╝ ╚═╝     ╚═╝ ╚═════╝
  Instalador Universal v1.0
BANNER
echo -e "${NC}"
sep

# ── Detectar plataforma ───────────────────────────────────────
detect_platform() {
  if [ -n "${TERMUX_VERSION:-}" ] || [ -d "/data/data/com.termux" ]; then
    echo "termux"
  elif [[ "$OSTYPE" == "darwin"* ]]; then
    echo "macos"
  elif command -v apt-get &>/dev/null; then
    echo "debian"
  elif command -v pacman &>/dev/null; then
    echo "arch"
  elif command -v dnf &>/dev/null; then
    echo "fedora"
  else
    echo "linux"
  fi
}

PLATFORM=$(detect_platform)
INSTALL_DIR="$HOME/wa-ollama"
REPO_URL="https://github.com/rendonbarco727-coder/instaladorv1.git"
NODE_MIN_VERSION=18

info "Plataforma detectada: ${BOLD}${PLATFORM}${NC}"
info "Instalando en: ${BOLD}${INSTALL_DIR}${NC}"
sep

# ════════════════════════════════════════════════════════════════
#  [1/6] Dependencias del sistema
# ════════════════════════════════════════════════════════════════
sep; echo -e "${BOLD}[1/6] Dependencias del sistema${NC}"; sep

pkg_installed_debian() { dpkg -s "$1" &>/dev/null 2>&1; }

install_system_deps_debian() {
  sudo apt-get update -qq
  local PKGS="git curl wget python3 python3-pip ffmpeg build-essential"
  for pkg in $PKGS; do
    if pkg_installed_debian "$pkg"; then
      ok "$pkg ya instalado"
    else
      info "Instalando $pkg..."
      sudo apt-get install -y "$pkg" -qq
      ok "$pkg instalado"
    fi
  done
  if command -v chromium-browser &>/dev/null || command -v chromium &>/dev/null || command -v google-chrome &>/dev/null; then
    ok "Chromium/Chrome ya disponible"
  else
    info "Instalando Chromium..."
    sudo apt-get install -y chromium-browser -qq 2>/dev/null \
      || sudo apt-get install -y chromium -qq 2>/dev/null \
      || warn "Instala Chromium manualmente si WhatsApp Web falla."
  fi
}

install_system_deps_arch() {
  sudo pacman -Syu --noconfirm --needed git curl wget python python-pip ffmpeg base-devel chromium
  ok "Dependencias arch instaladas"
}

install_system_deps_fedora() {
  sudo dnf install -y git curl wget python3 python3-pip ffmpeg gcc-c++ make chromium
  ok "Dependencias fedora instaladas"
}

install_system_deps_macos() {
  if ! command -v brew &>/dev/null; then
    info "Instalando Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  else
    ok "Homebrew ya instalado"
  fi
  for pkg in git curl wget python3 ffmpeg; do
    brew list "$pkg" &>/dev/null 2>&1 && ok "$pkg ya instalado" || brew install "$pkg"
  done
  brew list --cask google-chrome &>/dev/null 2>&1 \
    && ok "Chrome ya instalado" \
    || brew install --cask google-chrome
}

install_system_deps_termux() {
  pkg update -y -q
  for pkg in git curl wget python ffmpeg nodejs-lts proot-distro; do
    pkg list-installed 2>/dev/null | grep -q "^$pkg" \
      && ok "$pkg ya instalado" \
      || { pkg install -y "$pkg" -q; ok "$pkg instalado"; }
  done
  warn "En Termux, WhatsApp Web requiere proot Ubuntu + Chromium."
  warn "El bot usará el chat web local en puerto 3001."
}

case "$PLATFORM" in
  debian) install_system_deps_debian ;;
  arch)   install_system_deps_arch ;;
  fedora) install_system_deps_fedora ;;
  macos)  install_system_deps_macos ;;
  termux) install_system_deps_termux ;;
  *)      warn "Plataforma '$PLATFORM' no reconocida, saltando deps del sistema." ;;
esac

# ════════════════════════════════════════════════════════════════
#  [2/6] Node.js
# ════════════════════════════════════════════════════════════════
sep; echo -e "${BOLD}[2/6] Node.js${NC}"; sep

# Cargar nvm si existe
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh" 2>/dev/null || true

needs_node_install=false
if command -v node &>/dev/null; then
  NODE_VER=$(node -e "process.stdout.write(process.version.replace('v','').split('.')[0])")
  if [ "$NODE_VER" -ge "$NODE_MIN_VERSION" ]; then
    ok "Node.js $(node -v) ya instalado y compatible"
  else
    warn "Node.js $(node -v) demasiado antiguo (mínimo v${NODE_MIN_VERSION}). Actualizando..."
    needs_node_install=true
  fi
else
  info "Node.js no encontrado. Instalando..."
  needs_node_install=true
fi

if [ "$needs_node_install" = true ] && [ "$PLATFORM" != "termux" ]; then
  if [ ! -f "$HOME/.nvm/nvm.sh" ]; then
    info "Instalando nvm..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
    source "$NVM_DIR/nvm.sh"
  fi
  nvm install --lts
  nvm use --lts
  nvm alias default node
  ok "Node.js $(node -v) instalado via nvm"
fi

# ════════════════════════════════════════════════════════════════
#  [3/6] PM2 + yt-dlp
# ════════════════════════════════════════════════════════════════
sep; echo -e "${BOLD}[3/6] PM2 + yt-dlp${NC}"; sep

if command -v pm2 &>/dev/null; then
  info "Actualizando PM2..."
  npm install -g pm2@latest --silent
  ok "PM2 $(pm2 --version) actualizado"
else
  npm install -g pm2 --silent
  ok "PM2 $(pm2 --version) instalado"
fi

if command -v yt-dlp &>/dev/null; then
  yt-dlp -U 2>/dev/null || true
  ok "yt-dlp actualizado"
else
  pip3 install yt-dlp --quiet --break-system-packages 2>/dev/null \
    || pip3 install yt-dlp --quiet 2>/dev/null \
    || warn "yt-dlp no instalado. Las descargas de YouTube no funcionarán."
fi

# ════════════════════════════════════════════════════════════════
#  [4/6] Clonar / Actualizar código BMO
# ════════════════════════════════════════════════════════════════
sep; echo -e "${BOLD}[4/6] Código de BMO${NC}"; sep

if [ -d "$INSTALL_DIR/.git" ]; then
  info "Repositorio ya existe. Actualizando..."
  cd "$INSTALL_DIR"
  git fetch origin
  git pull origin main
  ok "Repositorio actualizado"
else
  info "Clonando BMO en $INSTALL_DIR..."
  git clone "$REPO_URL" "$INSTALL_DIR"
  ok "Repositorio clonado"
fi

cd "$INSTALL_DIR"
info "Instalando dependencias npm..."
npm install --silent
ok "Dependencias npm instaladas ($(npm list --depth=0 2>/dev/null | wc -l) paquetes)"

# ════════════════════════════════════════════════════════════════
#  [5/6] Configurar .env
# ════════════════════════════════════════════════════════════════
sep; echo -e "${BOLD}[5/6] API Keys (.env)${NC}"; sep

ENV_FILE="$INSTALL_DIR/.env"

if [ -f "$ENV_FILE" ]; then
  warn ".env ya existe."
  read -rp "¿Reconfigurar API keys? [s/N]: " RECONFIG
  [[ "$RECONFIG" =~ ^[sS]$ ]] && rm "$ENV_FILE" || { ok "Manteniendo .env existente."; }
fi

if [ ! -f "$ENV_FILE" ]; then
  read_key() {
    local label="$1" varname="$2" example="$3"
    printf "  ${CYAN}%-32s${NC} [ej: %s]: " "$label" "$example"
    read -r val
    echo "$varname=$val" >> "$ENV_FILE"
  }

  cat > "$ENV_FILE" << 'ENVHEADER'
# BMO — Variables de entorno
# Generado automáticamente por install_bmo.sh
# ⚠️  NUNCA subas este archivo a GitHub

ENVHEADER

  echo ""
  echo -e "${YELLOW}── Groq (recomendado, plan gratuito disponible)${NC}"
  echo -e "   ${CYAN}→ https://console.groq.com${NC}"
  read_key "GROQ_API_KEY_1 (obligatoria)" "GROQ_API_KEY_1" "gsk_..."
  read_key "GROQ_API_KEY_2 (opcional)"    "GROQ_API_KEY_2" "gsk_..."
  read_key "GROQ_API_KEY_3 (opcional)"    "GROQ_API_KEY_3" "gsk_..."
  read_key "GROQ_API_KEY_4 (opcional)"    "GROQ_API_KEY_4" "gsk_..."

  echo ""
  echo -e "${YELLOW}── Google Gemini${NC}"
  echo -e "   ${CYAN}→ https://aistudio.google.com/apikey${NC}"
  read_key "GEMINI_API_KEY_1 (obligatoria)" "GEMINI_API_KEY_1" "AIza..."
  read_key "GEMINI_API_KEY_2 (opcional)"    "GEMINI_API_KEY_2" "AIza..."
  read_key "GEMINI_API_KEY_3 (opcional)"    "GEMINI_API_KEY_3" "AIza..."
  read_key "GEMINI_API_KEY_4 (opcional)"    "GEMINI_API_KEY_4" "AIza..."
  read_key "GEMINI_API_KEY_5 (opcional)"    "GEMINI_API_KEY_5" "AIza..."

  echo ""
  echo -e "${YELLOW}── Mistral${NC}"
  echo -e "   ${CYAN}→ https://console.mistral.ai${NC}"
  read_key "MISTRAL_API_KEY" "MISTRAL_API_KEY" "..."

  echo ""
  echo -e "${YELLOW}── OpenAI (opcional)${NC}"
  read_key "OPENAI_API_KEY_1" "OPENAI_API_KEY_1" "sk-..."
  read_key "OPENAI_API_KEY_2" "OPENAI_API_KEY_2" "sk-..."
  read_key "OPENAI_API_KEY_3" "OPENAI_API_KEY_3" "sk-..."

  echo ""
  echo -e "${YELLOW}── xAI / Grok (opcional)${NC}"
  read_key "XAI_API_KEY_1" "XAI_API_KEY_1" "xai-..."
  read_key "XAI_API_KEY_2" "XAI_API_KEY_2" "xai-..."
  read_key "XAI_API_KEY_3" "XAI_API_KEY_3" "xai-..."
  read_key "XAI_API_KEY_4" "XAI_API_KEY_4" "xai-..."

  echo ""
  echo -e "${YELLOW}── Servicios adicionales${NC}"
  read_key "OPENWEATHER_API_KEY" "OPENWEATHER_API_KEY" "..."
  read_key "HUGGINGFACE_API_KEY" "HUGGINGFACE_API_KEY" "hf_..."
  read_key "EXA_API_KEY"         "EXA_API_KEY"         "..."
  read_key "BRAVE_API_KEY"       "BRAVE_API_KEY"        "..."

  # Defaults que no requieren input del usuario
  cat >> "$ENV_FILE" << ENVDEFAULTS

# ── Configuración interna (no modificar salvo que sepas lo que haces) ──
ADMIN_IDS=527351838760,100365164921021028,528123716915
PORT=3001
MUSIC_PORT=8090
WS_PORT=18790
OLLAMA_HOST=http://127.0.0.1:11434
PRIMARY_MODEL=qwen/qwen3-32b
ENVDEFAULTS

  ok ".env guardado en $ENV_FILE"
fi

# ════════════════════════════════════════════════════════════════
#  [6/6] Iniciar BMO + mostrar QR
# ════════════════════════════════════════════════════════════════
sep; echo -e "${BOLD}[6/6] Iniciando BMO${NC}"; sep

cd "$INSTALL_DIR"

info "Verificando sintaxis de index.js..."
node --check index.js && ok "Sintaxis OK" || err "Error en index.js. Revisa el código."

if pm2 list 2>/dev/null | grep -q "\bbmo\b"; then
  info "BMO ya registrado en PM2. Reiniciando..."
  pm2 restart bmo
else
  info "Iniciando BMO..."
  pm2 start index.js --name bmo --time
fi

pm2 save --force

if [ "$PLATFORM" != "termux" ]; then
  PM2_STARTUP=$(pm2 startup 2>/dev/null | grep "sudo" | head -1)
  [ -n "$PM2_STARTUP" ] && eval "$PM2_STARTUP" 2>/dev/null \
    || warn "Configura startup manualmente con: pm2 startup"
fi

ok "BMO iniciado"

sep
echo -e "${BOLD}${YELLOW}📱 ESCANEA EL QR DE WHATSAPP${NC}"
echo -e "${CYAN}El QR aparecerá en los logs a continuación."
echo -e "Escanéalo con WhatsApp → Dispositivos vinculados → Vincular dispositivo${NC}"
echo -e "${YELLOW}Presiona Ctrl+C cuando hayas escaneado el QR.${NC}"
sep
sleep 2
pm2 logs bmo --lines 0 --raw

sep
echo -e "${BOLD}${GREEN}"
echo "  ✅ BMO instalado y funcionando"
echo ""
echo "  Comandos útiles:"
echo "    pm2 logs bmo       — ver logs en vivo"
echo "    pm2 restart bmo    — reiniciar"
echo "    pm2 stop bmo       — detener"
echo "    pm2 monit          — monitor visual"
echo ""
echo "  Chat web: http://localhost:3001/chat.html"
echo -e "${NC}"
sep
