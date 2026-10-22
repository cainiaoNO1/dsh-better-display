import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const client = readFileSync(resolve(root, 'lib/client.js'), 'utf8');
// esbuild 把非 ASCII 转成 \uXXXX 转义，断言前先还原，否则搜不到中文标签。
const decoded = client.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

test('reader toolbar exposes the four global switches', () => {
  for (const label of ['自动折叠', '自动展开', '自动翻译', '自动跟随']) {
    assert.ok(decoded.includes(label), `缺少开关：${label}`);
  }
  for (const key of ['auto-fold', 'auto-expand', 'translate', 'auto-follow']) {
    assert.ok(client.includes(`"${key}"`) || client.includes(`'${key}'`), `缺少开关键：${key}`);
  }
  assert.match(client, /data-reader-toolbar/);
  assert.match(client, /data-reader-switch/);
});

test('toolbar switches are persisted through the root reader store', () => {
  const store = readFileSync(resolve(root, 'src/client/store.ts'), 'utf8');
  // 四个开关都必须落在根 store 的持久化键上，否则换会话就丢。
  assert.match(store, /persist: 'dsh\.reader\.v1'/);
  for (const action of ['setAutoFold', 'setAutoExpand', 'setTranslateReasoning', 'setAutoFollow']) {
    assert.ok(store.includes(action), `store 缺少动作：${action}`);
  }
  assert.match(store, /autoExpand: false/);
  assert.match(store, /autoFollow: true/);
});

test('toolbar portals into the conversation tabs row', () => {
  const toolbar = readFileSync(resolve(root, 'src/client/ReaderToolbar.tsx'), 'utf8');
  // 官方没给 tabs 行声明插槽，只能 portal；锁住这个前提，避免以后静默退回到
  // 和别的插件抢 conversation.session.header.corner。
  assert.match(toolbar, /createPortal/);
  assert.match(toolbar, /\[data-conversation-tabs\]/);
  assert.ok(client.includes('createPortal'), '构建产物里应有 createPortal');
});

test('auto-expand opens every reasoning card, not just the turn', () => {
  const card = readFileSync(resolve(root, 'src/client/ReasoningCard.tsx'), 'utf8');
  // 「自动展开」等于每次都点「展开阅读」，所以必须驱动卡片自己的 expanded。
  assert.match(card, /useState\(autoExpand\)/);
  assert.match(card, /setExpanded\(autoExpand\)/);
});

test('auto-expand overrides auto-fold in the reader', () => {
  const reader = readFileSync(resolve(root, 'src/client/Reader.tsx'), 'utf8');
  assert.match(reader, /const expanded = !autoFold \|\| autoExpand \|\|/);
});

test('auto-follow gates the reasoning card follow behaviour', () => {
  const card = readFileSync(resolve(root, 'src/client/ReasoningCard.tsx'), 'utf8');
  assert.match(card, /const allowed = autoFollow && following && active/);
});

test('settings panel mirrors the two new switches', () => {
  const section = readFileSync(resolve(root, 'src/client/SettingsSection.tsx'), 'utf8');
  assert.match(section, /data-better-display-auto-expand/);
  assert.match(section, /data-better-display-auto-follow/);
  assert.match(section, /setAutoExpand/);
  assert.match(section, /setAutoFollow/);
});
