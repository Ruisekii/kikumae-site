import { readFile } from 'node:fs/promises';

const checks = [];
const source = async (path) => readFile(path, 'utf8');
const repository = await source('db/repository.ts');
const createRoute = await source('app/api/questions/route.ts');
const statusRoute = await source('app/api/questions/status/[token]/route.ts');
const translationRoute = await source('app/api/admin/translation-eval/route.ts');

checks.push({ id: 'server-canonical-builder', pass: repository.includes('buildServerCanonicalIncident') && repository.includes('canonicalIncident') });
checks.push({ id: 'create-does-not-trust-incident', pass: !createRoute.includes('data.incident') && /createQuestion\([^\n]*undefined, transcript/.test(createRoute) });
checks.push({ id: 'followup-does-not-overwrite-original', pass: /UPDATE questions SET body = \?, ai_summary/.test(repository) && !/UPDATE questions SET body = \?, body_original = \?/.test(repository) });
checks.push({ id: 'followup-rebuilds-from-original', pass: repository.includes('current.bodyOriginal.trim()') && repository.includes('buildServerCanonicalIncident(combinedBody') });
checks.push({ id: 'status-does-not-trust-incident', pass: !statusRoute.includes('payload.incident') && statusRoute.includes('undefined, transcript') });
checks.push({ id: 'evaluation-endpoint-admin-auth', pass: translationRoute.includes('getAdminUser') && translationRoute.includes('if (!await getAdminUser(request))') });
checks.push({ id: 'shared-device-clear-scope', pass: (await source('app/components/consult-history.ts')).includes('kikumae-pending-submissions-v1') && (await source('app/components/question-status-lookup.tsx')).includes('clearResidentDeviceData') });

let evaluationEndpoint = null;
try {
  const response = await fetch('http://localhost:3000/api/admin/translation-eval', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-kikumae-eval-translation': '1', 'cf-connecting-ip': 'stabilization-contract' }, body: JSON.stringify({ text: 'She may have a fever.', language: 'en' }) });
  evaluationEndpoint = { status: response.status, lockedWithoutEvaluationGate: response.status === 404 };
} catch (error) {
  evaluationEndpoint = { status: 599, lockedWithoutEvaluationGate: false, error: String(error) };
}

const report = { schemaVersion: 'stabilization.contract.v1', generatedAt: new Date().toISOString(), checks, evaluationEndpoint, pass: checks.every((check) => check.pass) && evaluationEndpoint.lockedWithoutEvaluationGate === true, caveats: ['Source-contract checks verify that the trust boundary is wired; they do not replace a production authenticated integration test.', 'The endpoint lock assertion assumes the local environment has no evaluation override enabled.'] };
await import('node:fs/promises').then(({ writeFile }) => writeFile('docs/stabilization-contract-evaluation.json', JSON.stringify(report, null, 2)));
console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exitCode = 1;
