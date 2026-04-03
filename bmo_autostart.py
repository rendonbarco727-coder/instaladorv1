#!/usr/bin/env python3
"""
BMO Autostart — lanza cloudflared, captura la URL del túnel
e inyecta en musica.html automáticamente.
"""

import subprocess
import re
import time
import os
import signal
import sys
import logging

# ── Configuración ────────────────────────────────────────────
WAOLLAMA_DIR   = os.path.expanduser("~/wa-ollama")
HTML_PATH      = os.path.join(WAOLLAMA_DIR, "public", "musica.html")
SW_PATH        = os.path.join(WAOLLAMA_DIR, "public", "sw.js")
PORT           = 8090
TUNNEL_TIMEOUT = 60   # segundos máximos esperando la URL del túnel
URL_PATTERN    = re.compile(r"https://[a-z0-9\-]+\.trycloudflare\.com")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [BMO] %(message)s",
    datefmt="%H:%M:%S"
)
log = logging.getLogger("bmo")

processes = []

def cleanup(sig=None, frame=None):
    log.info("Apagando procesos...")
    for p in processes:
        try:
            p.terminate()
        except Exception:
            pass
    sys.exit(0)

signal.signal(signal.SIGTERM, cleanup)
signal.signal(signal.SIGINT, cleanup)


def inject_url(url: str):
    """Reemplaza la URL del túnel en musica.html y bumpa el SW."""
    if not os.path.exists(HTML_PATH):
        log.error(f"No se encontró {HTML_PATH}")
        return False

    with open(HTML_PATH, "r", encoding="utf-8") as f:
        content = f.read()

    # Reemplazar cualquier URL de trycloudflare existente
    new_content = URL_PATTERN.sub(url, content)

    if new_content == content:
        # Si no había URL previa, buscar y reemplazar el placeholder
        new_content = re.sub(
            r"const API\s*=\s*['\"].*?['\"]",
            f"const API='{url}'",
            content
        )

    with open(HTML_PATH, "w", encoding="utf-8") as f:
        f.write(new_content)

    log.info(f"✅ URL inyectada en musica.html: {url}")

    # Bumpar versión del service worker para forzar recarga en clientes
    if os.path.exists(SW_PATH):
        with open(SW_PATH, "r", encoding="utf-8") as f:
            sw = f.read()
        sw_new = re.sub(
            r"(bmo-music-v)(\d+)",
            lambda m: f"{m.group(1)}{int(m.group(2)) + 1}",
            sw
        )
        with open(SW_PATH, "w", encoding="utf-8") as f:
            f.write(sw_new)
        log.info("✅ Service worker bumpeado")

    return True


def start_cloudflared():
    """Inicia cloudflared y devuelve (proceso, url)."""
    log.info("Iniciando cloudflared...")
    proc = subprocess.Popen(
        ["cloudflared", "tunnel", "--url", f"http://localhost:{PORT}"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1
    )
    processes.append(proc)

    url = None
    deadline = time.time() + TUNNEL_TIMEOUT

    for line in proc.stdout:
        line = line.strip()
        if line:
            log.info(f"[cloudflared] {line}")

        match = URL_PATTERN.search(line)
        if match:
            url = match.group(0)
            log.info(f"🌐 Túnel detectado: {url}")
            break

        if time.time() > deadline:
            log.error("Timeout esperando URL del túnel")
            proc.terminate()
            return None, None

        if proc.poll() is not None:
            log.error("cloudflared terminó inesperadamente")
            return None, None

    return proc, url


def start_node():
    """Inicia el servidor Node.js."""
    log.info("Iniciando servidor Node.js...")
    proc = subprocess.Popen(
        ["node", "index.js"],
        cwd=WAOLLAMA_DIR,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1
    )
    processes.append(proc)
    log.info(f"✅ Node iniciado (PID {proc.pid})")

    # Leer y loggear las primeras líneas de Node en background
    def _tail():
        for line in proc.stdout:
            log.info(f"[node] {line.rstrip()}")
    import threading
    threading.Thread(target=_tail, daemon=True).start()

    return proc


def main():
    log.info("═══ BMO Autostart iniciando ═══")

    # 1. Lanzar cloudflared y capturar URL
    cf_proc, tunnel_url = start_cloudflared()
    if not tunnel_url:
        log.error("No se pudo obtener la URL del túnel. Abortando.")
        sys.exit(1)

    # 2. Inyectar URL en el HTML
    inject_url(tunnel_url)

    # 3. Iniciar servidor Node
    node_proc = start_node()

    log.info("═══ Todo en marcha ═══")
    log.info(f"   Túnel: {tunnel_url}")
    log.info(f"   App:   {tunnel_url}/musica.html")

    # 4. Mantener vivo — relanzar Node si se cae
    while True:
        time.sleep(10)

        if node_proc.poll() is not None:
            log.warning("⚠️  Node caído — relanzando...")
            processes.remove(node_proc)
            node_proc = start_node()

        if cf_proc.poll() is not None:
            log.warning("⚠️  cloudflared caído — relanzando túnel...")
            processes.remove(cf_proc)
            cf_proc, tunnel_url = start_cloudflared()
            if tunnel_url:
                inject_url(tunnel_url)


if __name__ == "__main__":
    main()
