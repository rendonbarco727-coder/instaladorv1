import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';

const execAsync = promisify(exec);
const TMP_PATH = '/tmp/bmo_test_';

// Validación sintáctica con node --check
export async function validarSintaxis(codigoOrRuta) {
    let ruta = codigoOrRuta;
    let esTemporal = false;

    // Si es código, guardar en tmp
    if (!codigoOrRuta.endsWith('.js') || !fs.existsSync(codigoOrRuta)) {
        ruta = `${TMP_PATH}${Date.now()}.mjs`;
        fs.writeFileSync(ruta, codigoOrRuta, 'utf8');
        esTemporal = true;
    }

    try {
        await execAsync(`node --check ${ruta}`);
        return { ok: true, error: null };
    } catch(e) {
        return { ok: false, error: e.stderr || e.message };
    } finally {
        if (esTemporal) try { fs.unlinkSync(ruta); } catch(e) {}
    }
}

// Prueba que el módulo importa correctamente
export async function probarImport(ruta) {
    const testCode = `
import('${ruta}').then(m => {
    const exports = Object.keys(m);
    console.log(JSON.stringify({ ok: true, exports }));
}).catch(e => {
    console.log(JSON.stringify({ ok: false, error: e.message }));
});`;

    const tmpTest = `${TMP_PATH}import_${Date.now()}.mjs`;
    fs.writeFileSync(tmpTest, testCode, 'utf8');

    try {
        const { stdout } = await execAsync(`node ${tmpTest}`, { timeout: 10000 });
        return JSON.parse(stdout.trim());
    } catch(e) {
        return { ok: false, error: e.message };
    } finally {
        try { fs.unlinkSync(tmpTest); } catch(e) {}
    }
}

// Pipeline completo de pruebas
export async function probarModulo(codigoOrRuta) {
    const resultados = { sintaxis: null, import: null, aprobado: false };

    // 1. Validar sintaxis
    resultados.sintaxis = await validarSintaxis(codigoOrRuta);
    if (!resultados.sintaxis.ok) {
        console.log(`[TESTER] Fallo sintaxis: ${resultados.sintaxis.error?.slice(0, 100)}`);
        return resultados;
    }
    console.log('[TESTER] Sintaxis OK');

    // 2. Probar import (solo si es archivo existente)
    if (fs.existsSync(codigoOrRuta)) {
        resultados.import = await probarImport(codigoOrRuta);
        if (!resultados.import?.ok) {
            console.log(`[TESTER] Fallo import: ${resultados.import?.error?.slice(0, 100)}`);
            return resultados;
        }
        console.log(`[TESTER] Import OK - exports: ${resultados.import.exports?.join(', ')}`);
    }

    resultados.aprobado = true;
    console.log('[TESTER] Módulo aprobado ✓');
    return resultados;
}
