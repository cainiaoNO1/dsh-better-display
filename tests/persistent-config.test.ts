import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadPersistentConfig, savePersistentConfig } from '../src/persistent-config.js';
import { findDefaultModel } from '../src/client/model-route.js';

test('loadPersistentConfig returns empty object when file missing', () => {
  const file = join(tmpdir(), `test-config-missing-${Date.now()}.json`);
  assert.deepEqual(loadPersistentConfig(file), {});
});

test('savePersistentConfig writes and merges config on disk', () => {
  const file = join(tmpdir(), `test-config-${Date.now()}.json`);
  try {
    savePersistentConfig({ translateReasoning: true, translatorProvider: 'p1', translatorModel: 'm1' }, file);
    const loaded = loadPersistentConfig(file);
    assert.equal(loaded.translateReasoning, true);
    assert.equal(loaded.translatorProvider, 'p1');
    assert.equal(loaded.translatorModel, 'm1');

    savePersistentConfig({ translatorMaxChars: 30000 }, file);
    const updated = loadPersistentConfig(file);
    assert.equal(updated.translateReasoning, true);
    assert.equal(updated.translatorMaxChars, 30000);
  } finally {
    try { rmSync(file); } catch {}
  }
});

test('findDefaultModel prefers deepseek flash models when available', () => {
  const routes = [
    { id: 'custom', name: 'Custom', models: [{ id: 'm-custom', name: 'Custom' }] },
    {
      id: 'deepseek-account',
      name: 'DeepSeek Account',
      models: [
        { id: 'deepseek-chat', name: 'Chat' },
        { id: 'deepseek-flash', name: 'DeepSeek Flash' },
      ],
    },
  ];
  const choice = findDefaultModel(routes);
  assert.deepEqual(choice, { provider: 'deepseek-account', model: 'deepseek-flash' });
});
