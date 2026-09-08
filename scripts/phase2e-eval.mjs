import { phase2eCases } from './phase2e-cases.mjs';
import { writeFile } from 'node:fs/promises';

const baseUrl = process.env.PHASE2E_BASE_URL || 'http://localhost:3000';
const values = (organization) => ['facts', 'requests', 'context', 'emotionalState', 'uncertainPoints', 'safetySignals'].flatMap((key) => (organization?.[key] || []).map((item) => item.value));
const has = (items, patterns = []) => patterns.length === 0 || patterns.every((pattern) => items.some((item) => pattern.test(item)));

async function runCase(testCase, fault = '') {
  const headers = { 'Content-Type': 'application/json', 'x-kikumae-eval-suite': 'phase2e' };
  if (fault) headers['x-kikumae-eval-fault'] = fault;
  const started = performance.now();
  const response = await fetch(`${baseUrl}/api/ai/voice`, { method: 'POST', headers, body: JSON.stringify({ mode: 'organize', text: testCase.text, selectedLanguage: /I told|water|Please/i.test(testCase.text) ? 'en' : /我|饮用水/.test(testCase.text) ? 'zh' : /식수|아이/.test(testCase.text) ? 'ko' : 'ja', state: { language: 'ja', location: null, target: null, facts: [], request: null, urgency: 'unknown', safetyFlags: [], missingFields: [], askedFields: [], originalText: [testCase.text] }, intake: {} }) });
  const payload = await response.json();
  return { ...payload, elapsedMs: Math.round(performance.now() - started), httpStatus: response.status };
}

const results = [];
for (const testCase of phase2eCases) {
  try {
    const result = await runCase(testCase);
    const organization = result.organization || {};
    const all = values(organization);
    const safetyValues = (organization.safetySignals || []).map((item) => item.value);
    const factHit = has(all, testCase.facts || []);
    const requestHit = testCase.request == null ? true : (organization.requests || []).some((item) => item.value === testCase.request);
    const contextHit = has(all, testCase.context || []);
    const emotionHit = testCase.emotion ? (organization.emotionalState || []).length > 0 : true;
    const uncertaintyHit = testCase.uncertain ? (organization.uncertainPoints || []).length > 0 : true;
    const safetyHit = testCase.safety ? safetyValues.length > 0 : true;
    const noSafetyHit = testCase.noSafety ? safetyValues.length === 0 : true;
    const separationHit = testCase.noSafety ? !(organization.facts || []).some((item) => /死ぬ|死んじゃ|最悪|見捨て/.test(item.value)) : true;
    const anchored = [...(organization.facts || []), ...(organization.requests || []), ...(organization.context || []), ...(organization.emotionalState || []), ...(organization.uncertainPoints || []), ...(organization.safetySignals || [])].every((item) => item.evidence && testCase.text.includes(item.evidence));
    results.push({ id: testCase.id, ok: factHit && requestHit && contextHit && emotionHit && uncertaintyHit && safetyHit && noSafetyHit && separationHit && anchored, factHit, requestHit, contextHit, emotionHit, uncertaintyHit, safetyHit, noSafetyHit, separationHit, anchored, elapsedMs: result.elapsedMs, aiMode: result.aiMode, organization });
  } catch (error) {
    results.push({ id: testCase.id, ok: false, error: String(error) });
  }
}

const fault = await runCase(phase2eCases[0], 'organization-down');
const successful = results.filter((result) => result.ok).length;
const elapsed = results.map((result) => result.elapsedMs).filter((value) => typeof value === 'number').sort((a, b) => a - b);
const percentile = (values, p) => values.length ? values[Math.min(values.length - 1, Math.floor(values.length * p))] : null;
const metrics = {
  schemaVersion: 'phase2e.v1', generatedAt: new Date().toISOString(), cases: phase2eCases.length, successful, failed: phase2eCases.length - successful,
  caseSuccessRate: phase2eCases.length ? successful / phase2eCases.length : 0,
  factRetentionRate: results.filter((result) => result.factHit).length / phase2eCases.length,
  requestRetentionRate: results.filter((result) => result.requestHit).length / phase2eCases.length,
  contextRetentionRate: results.filter((result) => result.contextHit).length / phase2eCases.length,
  emotionalStateRate: results.filter((result) => result.emotionHit).length / phase2eCases.length,
  uncertaintyRate: results.filter((result) => result.uncertaintyHit).length / phase2eCases.length,
  safetyRecall: results.filter((result, index) => !phase2eCases[index].safety || result.safetyHit).length / phase2eCases.length,
  safetyFalsePositiveFreeRate: results.filter((result) => result.noSafetyHit).length / phase2eCases.length,
  emotionalFactSeparationRate: results.filter((result) => result.separationHit).length / phase2eCases.length,
  anchoredEvidenceRate: results.filter((result) => result.anchored).length / phase2eCases.length,
  latencyMs: { p50: percentile(elapsed, 0.5), p95: percentile(elapsed, 0.95), max: elapsed.at(-1) ?? null },
  organizationFault: { aiMode: fault.aiMode, fallback: fault.telemetry?.fallback === true, safetyPreserved: Array.isArray(fault.safety?.flags) },
};
const output = { metrics, cases: results, faultTest: fault };
await writeFile('docs/phase2e-evaluation-latest.json', JSON.stringify(output, null, 2));
console.log(JSON.stringify(metrics, null, 2));
