import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';

const execAsync = promisify(exec);

export async function callMistral(prompt, options = {}) {
    const KEY = process.env.MISTRAL_API_KEY || '';
    const body = {
        model: options.model || 'mistral-small-latest',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: options.max_tokens || 2000,
        temperature: options.temperature ?? 0.7
    };
    const tmp = `/tmp/bmo_mistral_${Date.now()}.json`;
    fs.writeFileSync(tmp, JSON.stringify(body));
    try {
        const { stdout } = await execAsync(
            `curl -s --max-time 45 "https://api.mistral.ai/v1/chat/completions" ` +
            `-H "Content-Type: application/json" ` +
            `-H "Authorization: Bearer ${KEY}" -d @${tmp}`
        );
        const data = JSON.parse(stdout);
        if (data.error) throw new Error('Mistral: ' + (data.error.message||'').slice(0,100));
        return data.choices?.[0]?.message?.content || '';
    } finally {
        try { fs.unlinkSync(tmp); } catch(e) {}
    }
}
