import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
import type { AssistantBlock, MessageImageLoader } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives';
import type { PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-chat/client';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {} from '@deepseek-ai/dsh-client-ui-session/client';
import type { createReaderStore } from './store.js';
import type { OfficialSeat } from './official-slots.js';
import type { OpenFileOptions, TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client';
import type {} from '@deepseek-ai/dsh-client-ui-tool/client';

export interface ReaderBlockOwner {
  block: AssistantBlock;
  streaming: boolean;
  source: 'assistant' | 'user' | 'tool';
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Trusted installed renderers may opt in; unknown model payloads never execute code. */
    'dsh-better-display.block': { kind: 'chain'; scope: 'session'; owner: ReaderBlockOwner };
  }
}

export interface ReaderInjected {
  loadOlder: () => Promise<void>;
  loadImage: (attachment: ImageAttachmentRef) => Promise<{ data: Uint8Array; mediaType: string }>;
  /**
   * Writes text into this session's composer draft via the sanctioned
   * conversation input face, with a DOM fallback. Returns true when the
   * composer accepted the text.
   */
  fillComposer: (text: string) => boolean;
  /** Open a workspace file or directory; mode comes from the Better Display setting. */
  openFile: (path: string, options?: OpenFileOptions) => Promise<void> | void;
  officialImageLoader: MessageImageLoader;
  officialFileMentions: (owner: TurnTailOwnerProps) => MarkdownFileMentions | undefined;
  officialPreviewFile: (path: string) => void;
  officialHost: { getSnapshot: () => { home?: string }; subscribe: (listener: () => void) => () => void };
  /** Root-scoped Better Display prefs (`dsh.reader.v1`), shared with Settings. */
  openPrefs?: {
    getSnapshot: () => {
      deliverableOpenMode?: import('./open-file.js').DeliverableOpenMode;
      frostedGlass?: boolean;
      foldIntensity?: import('./fold-intensity.js').FoldIntensity;
      autoFold?: boolean;
      processOnly?: boolean;
      translateReasoning?: boolean;
      translatorProvider?: string;
      translatorModel?: string;
      translatorPrompt?: string;
      translatorMaxChars?: number;
      reasoningOriginal?: boolean;
      autoExpand?: boolean;
      autoFollow?: boolean;
    };
    subscribe: (fn: () => void) => () => void;
    actions?: {
      setFoldIntensity?: (value: import('./fold-intensity.js').FoldIntensity) => void;
      setAutoFold?: (value: boolean) => void;
      setFrostedGlass?: (value: boolean) => void;
      setDeliverableOpenMode?: (value: import('./open-file.js').DeliverableOpenMode) => void;
      setTranslateReasoning?: (value: boolean) => void;
      setTranslatorRoute?: (route: { provider: string; model: string }) => void;
      setReasoningOriginal?: (value: boolean) => void;
      setTranslatorPrompt?: (value: string) => void;
      setTranslatorMaxChars?: (value: number) => void;
      setAutoExpand?: (value: boolean) => void;
      setAutoFollow?: (value: boolean) => void;
    };
  };
  /** Reveal and highlight a workspace file in macOS Finder or Windows Explorer. */
  revealFile?: (path: string) => Promise<void> | void;
  /** Fork the conversation at a specific message sequence into a new branch session. */
  forkAt?: (seq: number) => void;
  /** Load session history through a target sequence number. */
  loadThrough?: (seq: unknown) => Promise<void>;
}
export type ReaderProps = PropsRuntime<'conversation.view'>
  & PropsLocale<'chat'>
  & PropsRenderSlots<'dsh-better-display.block' | OfficialSeat>
  & PropsStore<ReturnType<typeof createReaderStore>>
  & ReaderInjected;
export type BlockRenderProps = Pick<ReaderProps, 'renderSlotChain' | 'loadImage' | 'fillComposer'> & {
  official?: Pick<ReaderProps, 'renderSlot' | 'renderSlotChain' | 'officialImageLoader' | 'officialFileMentions' | 'officialPreviewFile' | 'officialHost' | 'openView'>;
  cwd?: string;
  openFile?: (path: string, options?: OpenFileOptions) => Promise<void> | void;
  revealFile?: (path: string) => Promise<void> | void;
  forkAt?: (seq: number) => void;
  /** Durable closing-message seq of this turn (turn-tail closing), used as the fork anchor. */
  forkSeq?: number;
  fileMentions?: MarkdownFileMentions;
  /** 思考翻译的目标模型与附加提示词；缺省或空路由表示不翻译。 */
  translationSettings?: { enabled: boolean; provider: string; model: string; prompt?: string; maxChars?: number };
  /** 思考卡片当前显示原文而不是译文。 */
  reasoningOriginal?: boolean;
  /** 在原文与译文之间切换。 */
  toggleReasoningOriginal?: () => void;
  /** 全局「自动跟随」开关。 */
  autoFollow?: boolean;
  /** 全局「自动展开」开关；打开后思考卡片默认就是展开态。 */
  autoExpand?: boolean;
  metrics?: {
    usage?: NonNullable<import('@deepseek-ai/dsh-client-ui-chat/client').TurnTailChatData['tokenUsage']>;
    runMs?: number;
    tokensPerSecond?: number;
    ttftMs?: number;
    /** Closing assistant-message time (turn-tail `closing.time`). */
    endedAt?: number;
  };
};
