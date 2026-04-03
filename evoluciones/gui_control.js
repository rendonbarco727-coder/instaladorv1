import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

const DISPLAY = 'DISPLAY=:99';

export async function abrirPrograma(programa) {
  await execAsync(`${DISPLAY} ${programa} &`);
  await new Promise(r => setTimeout(r, 2000));
  const { stdout } = await execAsync(`${DISPLAY} xdotool getactivewindow 2>/dev/null || echo ""`);
  return stdout.trim();
}

export async function tomarCaptura(ruta = '/tmp/screenshot.png') {
  await execAsync(`${DISPLAY} scrot ${ruta}`);
  return ruta;
}

export async function escribirTexto(texto) {
  await execAsync(`${DISPLAY} xdotool type --clearmodifiers "${texto}"`);
}

export async function presionarTecla(tecla) {
  await execAsync(`${DISPLAY} xdotool key ${tecla}`);
}

export async function clickEn(x, y) {
  await execAsync(`${DISPLAY} xdotool mousemove ${x} ${y} click 1`);
}

export async function listarVentanas() {
  const { stdout } = await execAsync(`${DISPLAY} wmctrl -l 2>/dev/null`);
  return stdout.trim();
}
