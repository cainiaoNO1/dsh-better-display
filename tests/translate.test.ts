import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  TRANSLATION_MAX_INPUT_CHARS,
  TRANSLATION_MAX_PROMPT_CHARS,
  buildSystemPrompt,
  collectText,
  readTranslationRequest,
  translateReasoning,
  type LlmFace,
} from '../src/translate.js';

function chunks(...items: unknown[]): AsyncIterable<{ type: string }> {
  return (async function* () {
    for (const item of items) yield item as { type: string };
  })();
}

test('readTranslationRequest rejects empty text and missing route', () => {
  assert.deepEqual(readTranslationRequest({ text: '   ', provider: 'a', model: 'b' }), { error: '思考内容为空' });
  assert.deepEqual(readTranslationRequest({ text: 'hello', provider: '', model: 'b' }), { error: '未选择翻译模型' });
  assert.deepEqual(readTranslationRequest({ text: 'hello', provider: 'a' }), { error: '未选择翻译模型' });
  assert.deepEqual(readTranslationRequest(null), { error: '思考内容为空' });
});

test('readTranslationRequest trims the route and clips oversized input', () => {
  const long = 'x'.repeat(TRANSLATION_MAX_INPUT_CHARS + 500);
  const result = readTranslationRequest({ text: long, provider: '  tokenrhythm ', model: ' deepseek ' });
  assert.ok('route' in result);
  assert.deepEqual(result.route, { provider: 'tokenrhythm', model: 'deepseek' });
  assert.equal(result.text.length, TRANSLATION_MAX_INPUT_CHARS);
});

test('collectText concatenates text deltas and ignores reasoning deltas', async () => {
  const result = await collectText(
    chunks(
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: '先' },
      { type: 'reasoning-delta', index: 0, text: 'IGNORED' },
      { type: 'text-delta', index: 0, text: '这样' },
      { type: 'finish', reason: { kind: 'stop' } },
    ),
    new AbortController().signal,
  );
  assert.equal(result.text, '先这样');
  assert.equal(result.finish, 'stop');
});

test('translateReasoning drives prepareCall then stream and returns trimmed text', async () => {
  const seen: { config?: Record<string, unknown>; options?: Record<string, unknown> } = {};
  const llm: LlmFace = {
    prepareCall: async config => {
      seen.config = config as unknown as Record<string, unknown>;
      return {
        config: { ...config, temperature: 0.2 },
        stream: options => {
          seen.options = options;
          return chunks(
            { type: 'text-delta', index: 0, text: '  译文 ' },
            { type: 'text-delta', index: 0, text: '正文  ' },
            { type: 'finish', reason: { kind: 'stop' } },
          );
        },
      };
    },
  };
  const text = await translateReasoning(llm, { text: 'hello world', route: { provider: 'p', model: 'm' } });
  assert.equal(text, '译文 正文');
  assert.deepEqual(seen.config?.provider, 'p');
  assert.deepEqual(seen.config?.model, 'm');
  assert.equal(seen.options?.system !== undefined, true);
  assert.equal(seen.options?.maxTokens, 4096);
  const messages = seen.options?.messages as { role: string; content: { type: string; text: string }[] }[];
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.role, 'user');
  assert.equal(messages[0]?.content[0]?.text, 'hello world');
});

test('translateReasoning surfaces a failed finish and an empty answer', async () => {
  const failing: LlmFace = {
    prepareCall: async config => ({
      config: { ...config },
      stream: () => chunks({ type: 'finish', reason: { kind: 'error' } }),
    }),
  };
  await assert.rejects(
    () => translateReasoning(failing, { text: 'x', route: { provider: 'p', model: 'm' } }),
    /翻译未完成（error）/,
  );

  const empty: LlmFace = {
    prepareCall: async config => ({
      config: { ...config },
      stream: () => chunks({ type: 'finish', reason: { kind: 'stop' } }),
    }),
  };
  await assert.rejects(
    () => translateReasoning(empty, { text: 'x', route: { provider: 'p', model: 'm' } }),
    /模型没有返回译文/,
  );
});

test('collectText keeps the provider failure message and status', async () => {
  const result = await collectText(
    chunks({
      type: 'finish',
      reason: { kind: 'error', failure: { message: 'insufficient balance', code: 'PAYMENT', status: 402 } },
    }),
    new AbortController().signal,
  );
  assert.equal(result.finish, 'error');
  assert.equal(result.failure, 'insufficient balance（HTTP 402）');

  // 没有 failure 时不能凭空编原因。
  const bare = await collectText(
    chunks({ type: 'finish', reason: { kind: 'aborted' } }),
    new AbortController().signal,
  );
  assert.equal(bare.failure, undefined);
});

test('buildSystemPrompt appends user instructions after the fixed rules', () => {
  const base = buildSystemPrompt();
  assert.match(base, /只输出译文/);
  assert.doesNotMatch(base, /用户附加要求/);

  const withPrompt = buildSystemPrompt('  保留工具名英文  ');
  assert.match(withPrompt, /只输出译文/);
  assert.match(withPrompt, /用户附加要求（优先遵守）：\n保留工具名英文$/);
  // 空白提示词不能凭空多出一段。
  assert.equal(buildSystemPrompt('   '), base);
  assert.equal(buildSystemPrompt(undefined), base);
});

test('buildSystemPrompt clips an oversized instruction', () => {
  const huge = 'x'.repeat(TRANSLATION_MAX_PROMPT_CHARS + 100);
  const built = buildSystemPrompt(huge);
  assert.equal(built.includes('x'.repeat(TRANSLATION_MAX_PROMPT_CHARS + 1)), false);
  assert.match(built, new RegExp(`x{${TRANSLATION_MAX_PROMPT_CHARS}}$`));
});

test('readTranslationRequest carries the prompt through and clips it', () => {
  const plain = readTranslationRequest({ text: 'hello', provider: 'p', model: 'm' });
  assert.ok('prompt' in plain);
  assert.equal(plain.prompt, '');

  const withPrompt = readTranslationRequest({ text: 'hello', provider: 'p', model: 'm', prompt: '用简洁中文' });
  assert.ok('prompt' in withPrompt);
  assert.equal(withPrompt.prompt, '用简洁中文');

  const long = readTranslationRequest({
    text: 'hello',
    provider: 'p',
    model: 'm',
    prompt: 'y'.repeat(TRANSLATION_MAX_PROMPT_CHARS + 50),
  });
  assert.ok('prompt' in long);
  assert.equal(long.prompt.length, TRANSLATION_MAX_PROMPT_CHARS);
});
