import { mkdir, writeFile } from 'node:fs/promises';

const ollamaUrl = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
const models = (process.env.PHASE2A5_MODELS ?? 'qwen3.5:2b,qwen3.5:4b').split(',').map((value) => value.trim()).filter(Boolean);
const outputPath = process.env.PHASE2A5_BENCHMARK_OUTPUT ?? 'docs/phase2a5-ollama-benchmark.json';

async function generate(model, keepAlive) {
  const started = performance.now();
  const response = await fetch(`${ollamaUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      system: 'あなたは避難所相談の短い会話補助です。怒りや不安を否定せず、必要な追加確認は一項目だけ尋ねます。JSONだけを返してください。',
      prompt: '利用者: 昨日から水がなく、子どももいるので困っています。場所だけ確認する短い返答を、replyとnextFieldとrequiresConfirmationで返してください。',
      format: { type: 'object', properties: { reply: { type: 'string' }, nextField: { type: ['string', 'null'] }, requiresConfirmation: { type: 'boolean' } }, required: ['reply', 'nextField', 'requiresConfirmation'] },
      think: false,
      stream: false,
      keep_alive: keepAlive,
      options: { temperature: 0.1, num_predict: 180 },
    }),
  });
  const data = await response.json();
  return {
    ok: response.ok,
    status: response.status,
    elapsedMs: Math.round(performance.now() - started),
    totalDurationMs: typeof data.total_duration === 'number' ? Math.round(data.total_duration / 1e6) : null,
    loadDurationMs: typeof data.load_duration === 'number' ? Math.round(data.load_duration / 1e6) : null,
    promptEvalDurationMs: typeof data.prompt_eval_duration === 'number' ? Math.round(data.prompt_eval_duration / 1e6) : null,
    evalDurationMs: typeof data.eval_duration === 'number' ? Math.round(data.eval_duration / 1e6) : null,
    promptEvalCount: data.prompt_eval_count ?? null,
    evalCount: data.eval_count ?? null,
    tokensPerSecond: data.eval_count && data.eval_duration ? Number((data.eval_count / (data.eval_duration / 1e9)).toFixed(2)) : null,
    responsePreview: typeof data.response === 'string' ? data.response.slice(0, 300) : null,
    error: data.error ?? null,
  };
}

async function ps() {
  try {
    const response = await fetch(`${ollamaUrl}/api/ps`);
    const data = await response.json();
    return (data.models ?? []).map((model) => ({ name: model.name, sizeBytes: model.size, sizeVramBytes: model.size_vram, contextLength: model.context_length }));
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

const results = [];
for (const model of models) {
  console.log(`${model}: cold load`);
  const cold = await generate(model, 0);
  console.log(`${model}: warm 1`);
  const warm1 = await generate(model, '5m');
  console.log(`${model}: warm 2`);
  const warm2 = await generate(model, '5m');
  results.push({ model, cold, warm: [warm1, warm2], loadedAfter: await ps() });
}

const report = { generatedAt: new Date().toISOString(), ollamaUrl, results };
await mkdir(outputPath.split(/[\\/]/).slice(0, -1).join('/') || '.', { recursive: true });
await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
const lines = [
  '# Phase 2A.5 Ollamaベンチマーク', '',
  `生成日時: ${report.generatedAt}`, '',
  '| モデル | Cold(ms) | Warm平均(ms) | Warm tok/s | load(ms) | VRAM(bytes) |',
  '|---|---:|---:|---:|---:|---:|',
  ...results.map((item) => {
    const warmMs = item.warm.map((entry) => entry.elapsedMs);
    const tok = item.warm.map((entry) => entry.tokensPerSecond).filter((value) => value !== null);
    const vram = item.loadedAfter?.[0]?.sizeVramBytes ?? 'n/a';
    return `| ${item.model} | ${item.cold.elapsedMs} | ${Math.round(warmMs.reduce((a, b) => a + b, 0) / warmMs.length)} | ${tok.length ? (tok.reduce((a, b) => a + b, 0) / tok.length).toFixed(2) : 'n/a'} | ${item.cold.loadDurationMs ?? 'n/a'} | ${vram} |`;
  }),
  '',
  'Ollamaの`size_vram`をGPU常駐量として記録しています。0の場合はこの実行ではGPUへオフロードされていません。',
];
await writeFile(outputPath.replace(/\.json$/i, '.md'), lines.join('\n'), 'utf8');
console.log(JSON.stringify(report, null, 2));
