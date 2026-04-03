// core/utils.js
export function estimarTokens(texto) {
    if (!texto) return 0;
    // Estimación estándar: 4 caracteres por token aprox.
    return Math.ceil(texto.length / 4);
}
