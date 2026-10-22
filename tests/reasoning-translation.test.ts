import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  REASONING_TRANSLATION_MAX_CHARS,
  clearTranslationCache,
  needsTranslation,
  shouldTranslate,
  translationCacheKey,
} from '../src/client/reasoning-translation.js';

test('needsTranslation skips Chinese-dominant reasoning', () => {
  assert.equal(needsTranslation('让我先看一下这个文件的内容，再决定怎么改'), false);
  assert.equal(needsTranslation('The user wants me to check the file first'), true);
  assert.equal(needsTranslation('先读 config 再改 index.ts'), false);
  assert.equal(needsTranslation('短'), false);
  assert.equal(needsTranslation(''), false);
});

test('needsTranslation keeps mixed text that is mostly Latin', () => {
  const mixed = 'I should read the config file 配置 then update the index 索引';
  assert.equal(needsTranslation(mixed), true);
});

test('translationCacheKey separates routes and text of equal length', () => {
  clearTranslationCache();
  const a = translationCacheKey('p1', 'm1', 'abcdef');
  const b = translationCacheKey('p2', 'm1', 'abcdef');
  const c = translationCacheKey('p1', 'm1', 'abcdeg');
  assert.notEqual(a, b);
  assert.notEqual(a, c);
  assert.equal(a, translationCacheKey('p1', 'm1', 'abcdef'));
  assert.equal(REASONING_TRANSLATION_MAX_CHARS, 12000);
});

test('translationCacheKey separates different instructions', () => {
  const a = translationCacheKey('p', 'm', 'same text', '用简洁中文');
  const b = translationCacheKey('p', 'm', 'same text', '用书面中文');
  assert.notEqual(a, b);
  assert.equal(a, translationCacheKey('p', 'm', 'same text', '用简洁中文'));
});

test('shouldTranslate only fires for reasoning that is or was on screen live', () => {
  const base = { enabled: true, provider: 'p', model: 'm', text: 'The user wants me to check the file' };

  // 正在输出 → 翻。
  assert.equal(shouldTranslate({ ...base, live: true, everLive: true }), true);
  // 刚刚输出完（live 变假但输出过）→ 允许补最后一次。
  assert.equal(shouldTranslate({ ...base, live: false, everLive: true }), true);
  // 纯历史记录，从没在眼前输出过 → 绝不翻。这是「切会话不烧钱」的核心断言。
  assert.equal(shouldTranslate({ ...base, live: false, everLive: false }), false);
  // 历史记录即使 live 为假也不该被 everLive 之外的条件放行。
  assert.equal(shouldTranslate({ ...base, live: true, everLive: false }), true);

  // 功能关 / 没选模型 → 不翻，哪怕正在输出。
  assert.equal(shouldTranslate({ ...base, enabled: false, live: true, everLive: true }), false);
  assert.equal(shouldTranslate({ ...base, provider: '', live: true, everLive: true }), false);
  assert.equal(shouldTranslate({ ...base, model: '', live: true, everLive: true }), false);
  // 中文原文 → 不翻。
  assert.equal(shouldTranslate({ ...base, text: '让我先读一下这个文件再决定怎么改', live: true, everLive: true }), false);
});
