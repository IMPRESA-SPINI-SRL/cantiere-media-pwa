import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('le intestazioni dei gruppi cantieri sono chiaramente evidenziate', async () => {
  const css = await readFile(resolve(root, 'css/style.css'), 'utf8');
  const match = css.match(/\.site-picker-group-title\s*\{([^}]+)\}/);
  assert.ok(match, 'regola .site-picker-group-title mancante');
  const rule = match[1];
  assert.match(rule, /color:\s*var\(--accent-strong\)/);
  assert.match(rule, /background:\s*linear-gradient/);
  assert.match(rule, /border-left:\s*4px solid var\(--accent\)/);
  assert.match(rule, /font-weight:\s*850/);
  assert.match(rule, /text-transform:\s*uppercase/);
});
