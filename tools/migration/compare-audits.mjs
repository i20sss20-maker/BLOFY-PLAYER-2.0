import { readFile } from 'node:fs/promises';

const [sourcePath, targetPath] = process.argv.slice(2);
if (!sourcePath || !targetPath) {
  console.error('Usage: node compare-audits.mjs <source-audit.json> <target-audit.json>');
  process.exit(2);
}

const load = async path => JSON.parse(await readFile(path, 'utf8'));
const source = await load(sourcePath);
const target = await load(targetPath);

function tableMap(report) {
  const map = new Map();
  for (const item of Array.isArray(report?.tables) ? report.tables : []) {
    map.set(`${item.schema}.${item.table}`, Number(item.rows || 0));
  }
  return map;
}

const left = tableMap(source);
const right = tableMap(target);
const names = [...new Set([...left.keys(), ...right.keys()])].sort();
const differences = names.flatMap(name => {
  const sourceRows = left.has(name) ? left.get(name) : null;
  const targetRows = right.has(name) ? right.get(name) : null;
  return sourceRows === targetRows ? [] : [{ table: name, sourceRows, targetRows }];
});

const schemaMatch = Boolean(source?.schemaFingerprint) && source.schemaFingerprint === target?.schemaFingerprint;
const countsMatch = differences.length === 0;
const result = {
  comparisonVersion: 1,
  schemaMatch,
  countsMatch,
  readyForCutoverReview: schemaMatch && countsMatch,
  sourceTableCount: left.size,
  targetTableCount: right.size,
  differences,
  privacy: 'Compares only schema fingerprints and aggregate table counts; no row values are read by this utility.',
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.readyForCutoverReview ? 0 : 1;
