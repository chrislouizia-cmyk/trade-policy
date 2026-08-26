import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

const dir = new URL('../supabase/migrations', import.meta.url);
const files = readdirSync(dir).filter((name) => name.endsWith('.sql')).sort();
const counts = new Map<string, string[]>();

for (const file of files) {
  const match = file.match(/^(\d{3})_/);
  if (!match) continue;

  const version = match[1];
  const existing = counts.get(version) ?? [];
  existing.push(file);
  counts.set(version, existing);
}

const duplicates = [...counts.entries()].filter(([, list]) => list.length > 1);

test('migration versions are unique across the repo', () => {
  if (duplicates.length === 0) {
    return;
  }

  const message = duplicates
    .map(([version, list]) => `Duplicate migration version ${version}: ${list.join(', ')}`)
    .join('\n');

  assert.fail(message);
});

for (const file of files) {
  const match = file.match(/^(\d{3})_/);
  if (!match) continue;

  test(`migration ${file} is readable`, () => {
    const sql = readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8');
    assert.ok(sql.length > 0, `${file} is empty`);
  });
}
