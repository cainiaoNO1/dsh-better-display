import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

/** 一次翻译所需的全部设置，来自根 store 的 `dsh.reader.v1`。 */
export interface TranslationSettings {
  enabled: boolean;
  provider: string;
  model: string;
  /** 附加到每次翻译系统提示词之后的用户自定义要求。 */
  prompt?: string;
  /** 单次翻译截取的字符上限。默认 12000。 */
  maxChars?: number;
}

export const TRANSLATION_OFF: TranslationSettings = { enabled: false, provider: '', model: '' };

/** 与宿主 `TRANSLATION_MAX_INPUT_CHARS` 保持一致；超出部分不翻译。 */
export const REASONING_TRANSLATION_MAX_CHARS = 12000;
/** 流式期间等这么久没新文本再翻，避免每个 token 发一次请求。 */
export const REASONING_TRANSLATION_IDLE_MS = 1600;
/** 太短的片段不值得单独翻译。 */
const MIN_TRANSLATABLE_CHARS = 12;
/**
 * 汉字占「汉字 + 拉丁字母」的比例达到这个值，就认为这段思考本来就是中文写的。
 * 用比例而不是「拉丁字母多于汉字」是因为中英混排时标识符会把拉丁字母数拉高
 * ——「先读 config 再改 index.ts」是中文句子，不该翻。
 */
const CJK_DOMINANT_RATIO = 0.15;
/** 译文缓存条数上限；超出后丢最早的一条。 */
const CACHE_LIMIT = 240;

export type TranslationState =
  | { status: 'off' }
  | { status: 'pending'; text?: string }
  | { status: 'done'; text: string; partial: boolean }
  | { status: 'error'; message: string; text?: string };

export type TranslationHandle = TranslationState & {
  /** 手动触发一次翻译（例如用户切到会话前已完成的旧思考卡片）。 */
  trigger: () => void;
};

/** FNV-1a 32 位散列，只用来做缓存键。 */
function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function translationCacheKey(provider: string, model: string, text: string, prompt = ''): string {
  // 提示词必须参与散列：长度相同、内容不同的两套指令会产出不同译文，
  // 只用长度做键会把它们混成同一条缓存。
  const stamp = prompt ? hashText(prompt) : '';
  return `${provider}\u0000${model}\u0000${stamp}\u0000${text.length}\u0000${hashText(text)}`;
}

const cache = new Map<string, string>();

function remember(key: string, value: string): void {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, value);
}

/** 测试用：清空缓存。 */
export function clearTranslationCache(): void {
  cache.clear();
}

/**
 * 什么时候才该为一段思考发翻译请求。
 *
 * 这是整个功能最容易被改错的地方，所以抽成纯函数单独测：
 * - 关掉功能 / 没选模型 / 不需要翻译 → 不翻；
 * - 从没在眼前输出过（历史记录、切过来的旧会话、没激活的子代理）→ 不翻；
 * - 正在输出 → 翻；
 * - 刚刚输出完（`live` 变假）且之前确实输出过 → 允许补最后一次。
 */
export function shouldTranslate(input: {
  enabled: boolean;
  provider: string;
  model: string;
  text: string;
  live: boolean;
  everLive: boolean;
}): boolean {
  if (!input.enabled || !input.provider || !input.model) return false;
  if (!needsTranslation(input.text)) return false;
  return input.live || input.everLive;
}

/**
 * 这段思考值不值得翻。汉字在「汉字 + 拉丁字母」里占到一定比例，就说明这段
 * 思考本来就是中文写的，翻它没有意义 —— 既省钱，也避免把通顺的中文重写一遍。
 */
export function needsTranslation(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < MIN_TRANSLATABLE_CHARS) return false;
  let cjk = 0;
  let latin = 0;
  for (const char of trimmed) {
    const code = char.codePointAt(0) ?? 0;
    if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf)) cjk += 1;
    else if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) latin += 1;
  }
  const letters = cjk + latin;
  // 纯符号、纯数字、纯代码片段都不翻。
  if (letters === 0) return false;
  return cjk / letters < CJK_DOMINANT_RATIO;
}

async function requestTranslation(
  settings: TranslationSettings,
  text: string,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch('/better-display/translate-reasoning', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      provider: settings.provider,
      model: settings.model,
      prompt: settings.prompt ?? '',
      maxChars: settings.maxChars,
    }),
    signal,
  });
  const payload = await response.json().catch(() => undefined) as
    | { ok?: boolean; text?: string; error?: string }
    | undefined;
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error ?? `翻译请求失败（HTTP ${response.status}）`);
  }
  const translated = typeof payload.text === 'string' ? payload.text : '';
  if (!translated.trim()) throw new Error('模型没有返回译文');
  return translated;
}

/**
 * 把一段**正在输出**的思考翻译成中文。
 *
 * 只有 `live` 为真（这段思考此刻还在往外吐字）才会发起翻译 —— 翻历史记录既
 * 没有意义，也会在切会话时一次性烧掉大量调用。
 *
 * 节奏是「首次立即翻 + 节流跟进」，而不是纯防抖：纯防抖在连续输出时永远等不到
 * 静默窗口，译文会一直空着；节流则保证最多每 `REASONING_TRANSLATION_IDLE_MS`
 * 就有一次新请求，边写边看也有中文可读。
 *
 * 关键实现约束：**请求不随文本变化中止**。流式输出时 `text` 每个字都在变，
 * 若把在途请求挂在依赖 `text` 的 effect 清理函数上，请求会在返回前被反复取消，
 * 译文永远出不来。所以这里用一个只受「设置变化 / 卸载」影响的请求引擎，
 * 文本变化只是通知它「该考虑发下一次了」。
 */
export function useReasoningTranslation(
  settings: TranslationSettings,
  text: string,
  live: boolean,
): TranslationHandle {
  const [state, setState] = useState<TranslationState>({ status: 'off' });
  const [manual, setManual] = useState(false);
  const { enabled, provider, model, prompt = '', maxChars = REASONING_TRANSLATION_MAX_CHARS } = settings;
  /** 这张卡片是否曾经「正在输出」；一上来就是历史记录的卡片永远为假。 */
  const everLive = useRef(false);
  if (live) everLive.current = true;
  const autoTranslatable = shouldTranslate({ enabled, provider, model, text, live, everLive: everLive.current });
  const manualTranslatable = manual && needsTranslation(text);
  const translatable = autoTranslatable || manualTranslatable;

  const trigger = useCallback(() => {
    setManual(true);
  }, []);

  // 异步回调需要读到「此刻」的输入，才能判断结果是否已经过期。
  const latest = useRef({ text, translatable, live, enabled, provider, model, prompt, maxChars, manual });
  latest.current = { text, translatable, live, enabled, provider, model, prompt, maxChars, manual };

  /** 在途请求；同一时刻最多一个，避免并发把配额打满。 */
  const inFlight = useRef<{ controller: AbortController; clipped: string } | undefined>(undefined);
  /** 节流定时器。 */
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastSentAt = useRef(0);
  const lastSentClipped = useRef('');
  /** 已完成的译文，键是它对应的原文片段，用于输出结束后保留中文。 */
  const settled = useRef<{ clipped: string; translated: string; partial: boolean } | undefined>(undefined);
  const pumpRef = useRef<() => void>(() => {});

  const pump = useCallback(() => {
    const now = latest.current;
    if (!now.translatable) {
      settled.current = undefined;
      lastSentClipped.current = '';
      setState({ status: 'off' });
      return;
    }
    if (!now.provider || !now.model) {
      if (now.manual) {
        setState({ status: 'error', message: '未选择翻译模型，请先到设置中选定模型' });
      } else {
        setState({ status: 'off' });
      }
      return;
    }
    const clipped = clipForTranslation(now.text, now.maxChars);
    const partial = clipped.length < now.text.length;
    // 这段文本已经有译文了：直接显示，不必再发请求。
    const done = settled.current;
    if (done && done.clipped === clipped) {
      setState({ status: 'done', text: done.translated, partial: done.partial });
      return;
    }
    // 有请求在飞就等它回来，回来后会再 pump 一次追上更新的文本。
    if (inFlight.current) return;

    const key = translationCacheKey(now.provider, now.model, clipped, now.prompt);
    const cached = cache.get(key);
    if (cached !== undefined) {
      settled.current = { clipped, translated: cached, partial };
      setState({ status: 'done', text: cached, partial });
      return;
    }
    if (clipped === lastSentClipped.current) return;

    // 冷却期没过就排个定时器；手动触发或输出已结束（!live）时不再等待。
    const wait = now.live && !now.manual ? Math.max(0, REASONING_TRANSLATION_IDLE_MS - (Date.now() - lastSentAt.current)) : 0;
    if (wait > 0) {
      if (timer.current === undefined) {
        timer.current = setTimeout(() => {
          timer.current = undefined;
          pumpRef.current();
        }, wait);
      }
      return;
    }

    const controller = new AbortController();
    inFlight.current = { controller, clipped };
    lastSentAt.current = Date.now();
    lastSentClipped.current = clipped;
    setState(previous => previous.status === 'done' || previous.status === 'pending'
      ? { status: 'pending', text: previous.text }
      : { status: 'pending' });
    void (async () => {
      try {
        const translated = await requestTranslation(
          { enabled: now.enabled, provider: now.provider, model: now.model, prompt: now.prompt, maxChars: now.maxChars },
          clipped,
          controller.signal,
        );
        remember(key, translated);
        inFlight.current = undefined;
        // 只有文本没在这期间继续变长，这次译文才算「当前」的。
        if (clipForTranslation(latest.current.text, now.maxChars) === clipped) {
          settled.current = { clipped, translated, partial };
          setState({ status: 'done', text: translated, partial });
        }
        pumpRef.current();
      } catch (error) {
        inFlight.current = undefined;
        if (controller.signal.aborted) return;
        // 失败不自动重试，否则坏路由会无限烧调用；用户改设置或文本再变时才重来。
        setState(previous => ({
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
          text: previous.status === 'done' || previous.status === 'pending' ? previous.text : undefined,
        }));
      }
    })();
  }, []);
  pumpRef.current = pump;

  // 文本 / 活跃状态变化只是「催一下」，不会中止在途请求。
  useEffect(() => { pump(); }, [pump, translatable, live, text]);

  // 换模型、改提示词、改上限、开关功能：旧译文作废，在途请求取消。
  useEffect(() => {
    settled.current = undefined;
    lastSentClipped.current = '';
    lastSentAt.current = 0;
    // 换模型/提示词时不清 everLive：这段思考确实输出过，仍允许补一次。
    if (timer.current !== undefined) {
      clearTimeout(timer.current);
      timer.current = undefined;
    }
    inFlight.current?.controller.abort();
    inFlight.current = undefined;
    pumpRef.current();
  }, [enabled, provider, model, prompt, maxChars]);

  // 卸载（切走会话、卡片被折叠掉）时收尾，别让模型白跑。
  useEffect(() => () => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    inFlight.current?.controller.abort();
    inFlight.current = undefined;
  }, []);

  return {
    ...state,
    trigger,
  };
}

/** 超出上限的思考只翻前一段；完整原文仍然原样可读。 */
export function clipForTranslation(text: string, maxChars = REASONING_TRANSLATION_MAX_CHARS): string {
  const cap = typeof maxChars === 'number' && maxChars > 0 ? maxChars : REASONING_TRANSLATION_MAX_CHARS;
  return text.length > cap
    ? text.slice(0, cap)
    : text;
}

/** 卡片与正文之间的「看原文 / 看译文」开关。 */
export interface ReasoningTranslationToggle extends TranslationSettings {
  showOriginal: boolean;
  /** 在原文与译文之间切换；未接入设置时为 undefined。 */
  toggle?: () => void;
}

export const ReasoningTranslationContext = createContext<ReasoningTranslationToggle>({
  ...TRANSLATION_OFF,
  showOriginal: false,
});

export function useReasoningTranslationToggle(): ReasoningTranslationToggle {
  return useContext(ReasoningTranslationContext);
}
