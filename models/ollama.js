import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function callOllama(prompt, options = {}) {
    const model = options.model || 'qwen2.5:1.5b';
    const body = JSON.stringify({
        model,
        prompt,
        stream: false,
        options: {
            temperature: options.temperature ?? 0.7,
            num_predict: options.max_tokens || 1000
        }
    });
    // Escribir a archivo temporal para evitar corrupción de caracteres especiales en shell
    const tmpFile = `/tmp/ollama_req_${Date.now()}.json`;
    const { default: fs } = await import('fs');
    fs.writeFileSync(tmpFile, body);
    try {
        const { stdout } = await execAsync(
            `curl -s --max-time 30 "http://localhost:11434/api/generate" ` +
            `-H "Content-Type: application/json" -d @${tmpFile}`
        );
        return JSON.parse(stdout).response || '';
    } finally {
        try { fs.unlinkSync(tmpFile); } catch(e) {}
    }
}
