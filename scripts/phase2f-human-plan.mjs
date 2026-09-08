import { writeFile } from 'node:fs/promises';
import { phase2fCases } from './phase2f-cases.mjs';

const seed = 20260909;
function random() {
  let value = seedState;
  value = (value * 1664525 + 1013904223) >>> 0;
  seedState = value;
  return value / 0x100000000;
}
let seedState = seed >>> 0;

const ordered = [...phase2fCases].sort(() => random() - 0.5);
const split = new Map(ordered.map((testCase, index) => [testCase.id, index % 2 === 0 ? 'X' : 'Y']));
const sessionOrder = [...ordered].sort(() => random() - 0.5).map((testCase) => testCase.id);
const conditionFor = (group, id) => {
  const set = split.get(id);
  if (group === 'Group 1') return set === 'X' ? 'A' : 'B';
  return set === 'X' ? 'B' : 'A';
};

const buildSlot = (slot, population, group) => ({
  slot,
  population,
  group,
  cases: sessionOrder.map((id, index) => ({ order: index + 1, caseId: id, condition: conditionFor(group, id) })),
});

const plan = {
  schemaVersion: 'phase2f.human-plan.v1',
  generatedAt: new Date().toISOString(),
  seed,
  caseCount: phase2fCases.length,
  sets: { X: ordered.filter((testCase) => split.get(testCase.id) === 'X').map((testCase) => testCase.id), Y: ordered.filter((testCase) => split.get(testCase.id) === 'Y').map((testCase) => testCase.id) },
  slots: [
    buildSlot('pilot-01', 'Pilot', 'Group 1'),
    buildSlot('pilot-02', 'Pilot', 'Group 2'),
    buildSlot('pilot-03', 'Pilot', 'Group 1'),
    buildSlot('pilot-04', 'Pilot', 'Group 2'),
    buildSlot('practitioner-01', 'Professional / practitioner', 'Group 1'),
    buildSlot('practitioner-02', 'Professional / practitioner', 'Group 2'),
    buildSlot('practitioner-03', 'Professional / practitioner', 'Group 1'),
    buildSlot('practitioner-04', 'Professional / practitioner', 'Group 2'),
  ],
  responseCollectionStarted: false,
  note: '匿名の割り当てテンプレートのみ。参加者情報・回答は含まない。',
};

await writeFile('docs/phase2f-human-evaluation-plan.json', JSON.stringify(plan, null, 2), 'utf8');
console.log(JSON.stringify({ outputPath: 'docs/phase2f-human-evaluation-plan.json', caseCount: plan.caseCount, slots: plan.slots.length, responseCollectionStarted: false }, null, 2));
