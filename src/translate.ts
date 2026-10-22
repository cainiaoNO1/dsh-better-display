/**
 * 思考翻译的宿主侧实现。
 *
 * 浏览器拿不到 `ctx.llm`，所以翻译必须走一条宿主路由。这里刻意不 import
 * `@deepseek-ai/dsh-llm`：profile 的 node_modules 里没有这个包，运行期能否
 * 解析取决于加载器的根目录。一次性调用需要的两样东西都可以就地手写 ——
 * `messages` 接受无身份的 `{ role: 'user', content }`，文本则从
 * `text-delta` 块自己累加，行为与 `BlockAssembler` 对纯文本流的结果一致。
 *
 * @module dsh-better-display/translate
 */

/** 一次翻译请求的目标模型路由。 */
export interface TranslationRoute {
  provider: string;
  model: string;
}

/** 路由侧能接受的最小 LLM 服务形状。 */
export interface LlmFace {
  prepareCall: (
    config: { provider: string; model: string; maxTokens?: number },
    signal?: AbortSignal,
    configure?: (controls: Record<string, unknown>, model: unknown) => Record<string, unknown>,
  ) => Promise<{
    config: Record<string, unknown>;
    stream: (options: Record<string, unknown>) => AsyncIterable<ReasoningChunk>;
  }>;
  listProviders?: () => { id: string; name: string }[];
  listModels?: (provider: string) => Promise<{ provider: string; id: string; name: string }[]>;
}

/** 只关心文本与终止原因的最小 chunk 形状。 */
type ReasoningChunk =
  | { type: 'text-delta'; text: string }
  | { type: 'reasoning-delta'; text: string }
  | { type: 'finish'; reason: { kind: string } }
  | { type: string };

/** 单次翻译的输入默认上限；超过就截断，避免把整轮思考灌进一次请求。 */
export const TRANSLATION_MAX_INPUT_CHARS = 12000;
/** 用户在设置里允许放大的绝对安全上限。 */
export const TRANSLATION_HARD_MAX_CHARS = 100000;
/** 输出预算上限。译文长度通常与原文同量级，中文更短。 */
export const TRANSLATION_MAX_OUTPUT_TOKENS = 8192;
/** 单次翻译超时。 */
export const TRANSLATION_TIMEOUT_MS = 90_000;

const SYSTEM_PROMPT = [
  '你是一个翻译器，把模型的中文/英文思考过程翻译成简体中文。',
  '',
  '规则：',
  '1. 只输出译文，不要任何前言、说明、标题或"以下是翻译"之类的话。',
  '2. 代码、命令、文件路径、变量名、函数名、API 名、专有技术名词保持英文原样，不要翻译。',
  '3. 保留原文的段落结构、换行和列表符号。',
  '4. 原文里已有的中文原样保留。',
  '5. 不要总结、不要扩写、不要解释，逐句对应翻译。',
].join('\n');

/** 用户在设置里追加的提示词上限；防止把整篇文档粘进来。 */
export const TRANSLATION_MAX_PROMPT_CHARS = 2000;

/**
 * 把用户自定义提示词接到固定系统提示词后面。
 * 放在最后一段是有意的：模型对末尾指令的遵从度更高，用户的偏好应该压过默认规则。
 */
export function buildSystemPrompt(extra?: string): string {
  const trimmed = typeof extra === 'string' ? extra.trim() : '';
  if (!trimmed) return SYSTEM_PROMPT;
  const clipped = trimmed.length > TRANSLATION_MAX_PROMPT_CHARS
    ? trimmed.slice(0, TRANSLATION_MAX_PROMPT_CHARS)
    : trimmed;
  return `${SYSTEM_PROMPT}\n\n用户附加要求（优先遵守）：\n${clipped}`;
}

/** 校验并收敛一次翻译请求的入参。 */
export function readTranslationRequest(body: unknown): { text: string; route: TranslationRoute; prompt: string; maxChars?: number } | { error: string } {
  const data = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const text = typeof data.text === 'string' ? data.text : '';
  if (!text.trim()) return { error: '思考内容为空' };
  const provider = typeof data.provider === 'string' ? data.provider.trim() : '';
  const model = typeof data.model === 'string' ? data.model.trim() : '';
  if (!provider || !model) return { error: '未选择翻译模型' };
  const prompt = typeof data.prompt === 'string' ? data.prompt : '';
  const requestedMax = typeof data.maxChars === 'number' && Number.isFinite(data.maxChars) && data.maxChars > 0
    ? Math.min(Math.floor(data.maxChars), TRANSLATION_HARD_MAX_CHARS)
    : TRANSLATION_MAX_INPUT_CHARS;
  return {
    text: text.length > requestedMax ? text.slice(0, requestedMax) : text,
    route: { provider, model },
    prompt: prompt.length > TRANSLATION_MAX_PROMPT_CHARS ? prompt.slice(0, TRANSLATION_MAX_PROMPT_CHARS) : prompt,
    maxChars: requestedMax,
  };
}

/** 从 chunk 流里累加可见文本，返回译文与终止原因。 */
export async function collectText(
  stream: AsyncIterable<ReasoningChunk>,
  signal: AbortSignal,
): Promise<{ text: string; finish: string; failure?: string }> {
  let text = '';
  let finish = 'stop';
  let failure: string | undefined;
  for await (const chunk of stream) {
    signal.throwIfAborted();
    if (chunk.type === 'text-delta') text += (chunk as { text: string }).text;
    else if (chunk.type === 'finish') {
      const reason = (chunk as { reason?: { kind?: string; failure?: { message?: string; status?: number } } }).reason;
      finish = reason?.kind ?? 'stop';
      // 供应商真正的原因在 failure 里；只回 kind 会让用户看到没有信息量的「error」。
      const message = reason?.failure?.message;
      if (message) failure = reason?.failure?.status ? `${message}（HTTP ${reason.failure.status}）` : message;
    }
  }
  return { text: text.trim(), finish, failure };
}

/**
 * 用指定路由翻译一段思考。
 * @param llm - 宿主 LLM 服务。
 * @param input - 已校验的文本与路由。
 * @param outer - 上游取消信号（客户端断开时触发）。
 */
export async function translateReasoning(
  llm: LlmFace,
  input: { text: string; route: TranslationRoute; prompt?: string },
  outer?: AbortSignal,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(new Error('翻译超时')); }, TRANSLATION_TIMEOUT_MS);
  const onAbort = () => { controller.abort(outer?.reason); };
  outer?.addEventListener('abort', onAbort, { once: true });
  try {
    const maxTokens = Math.min(
      TRANSLATION_MAX_OUTPUT_TOKENS,
      Math.max(4096, Math.ceil(input.text.length / 2)),
    );
    const call = await llm.prepareCall(
      { ...input.route, maxTokens },
      controller.signal,
    );
    const messages = [{ role: 'user', content: [{ type: 'text', text: input.text }] }];
    const stream = call.stream({
      ...call.config,
      messages,
      system: buildSystemPrompt(input.prompt),
      maxTokens,
      signal: controller.signal,
    });
    const { text, finish, failure } = await collectText(stream, controller.signal);
    if (finish === 'error' || finish === 'aborted') {
      throw new Error(failure ? `翻译未完成：${failure}` : `翻译未完成（${finish}）`);
    }
    if (!text) throw new Error('模型没有返回译文');
    return text;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onAbort);
  }
}

/** 汇总可用于翻译的 provider/model 列表。单个 provider 失败不影响其余。 */
export async function listTranslationModels(llm: LlmFace): Promise<
  { id: string; name: string; models: { id: string; name: string }[] }[]
> {
  const providers = typeof llm.listProviders === 'function' ? llm.listProviders() : [];
  return Promise.all(providers.map(async provider => {
    let models: { id: string; name: string }[] = [];
    if (typeof llm.listModels === 'function') {
      try {
        const listed = await llm.listModels(provider.id);
        models = listed.map(model => ({ id: model.id, name: model.name }));
      } catch {
        // 目录查询失败时只暴露 provider，用户仍可手填模型名。
      }
    }
    return { id: provider.id, name: provider.name, models };
  }));
}
