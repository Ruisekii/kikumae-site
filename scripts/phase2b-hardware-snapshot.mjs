import { writeFile } from 'node:fs/promises';

const ollamaUrl = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
const outputPath = process.env.PHASE2B_HARDWARE_OUTPUT ?? 'docs/phase2b-hardware-latest.json';
async function get(path, options) { try { const response = await fetch(`${ollamaUrl}${path}`, options); return { status: response.status, data: await response.json() }; } catch (error) { return { status: 599, error: error instanceof Error ? error.message : String(error) }; } }
const tags = await get('/api/tags');
const ps = await get('/api/ps');
const qwen9b = await get('/api/show', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'qwen3.5:9b' }) });
const report = {
  generatedAt: new Date().toISOString(), ollamaUrl,
  models: Array.isArray(tags.data?.models) ? tags.data.models.map((model) => ({ name: model.name, sizeBytes: model.size, quantization: model.details?.quantization_level, parameterSize: model.details?.parameter_size })) : [],
  loaded: Array.isArray(ps.data?.models) ? ps.data.models.map((model) => ({ name: model.name, sizeVramBytes: model.size_vram, sizeBytes: model.size })) : [],
  qwen9b: { installed: qwen9b.status >= 200 && qwen9b.status < 300, status: qwen9b.status },
  interpretation: 'CPU/RAM/GPUのOS監査はdocs/phase2a5-hardware-audit.mdを正本とし、ここではOllama APIから取得できるモデル・ロード状態を追加記録する。',
};
await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify(report, null, 2));
