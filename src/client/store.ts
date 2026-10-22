import { defineStore } from '@deepseek-ai/dsh-client-store';
import type { EngineStoreHandle } from '@deepseek-ai/dsh-client-store';
import {
  FOLD_INTENSITY_DEFAULT,
  autoFoldFromIntensity,
  processOnlyFromIntensity,
  type FoldIntensity,
} from './fold-intensity.js';
import type { DeliverableOpenMode } from './open-file.js';

/** 思考翻译的目标模型路由；空字符串表示还没选。 */
export interface TranslatorRoute {
  provider: string;
  model: string;
}

export interface ReaderState {
  expanded: Record<string, boolean>;
  motion: boolean;
  /** Derived from foldIntensity; kept so older persisted snapshots still read. */
  autoFold: boolean;
  /** Default stays the system app. `sidebar` is opt-in. */
  deliverableOpenMode: DeliverableOpenMode;
  /**
   * 0 = no auto-fold, 1 = current-main fold-on-next-reasoning (default),
   * 2 = process-summary mode from community PR #14.
   */
  foldIntensity: FoldIntensity;
  /** Translucent frosted chrome. Default off so opaque main chrome stays. */
  frostedGlass: boolean;
  /** Derived from foldIntensity === 2; kept for older #14 snapshots. */
  processOnly: boolean;
  /** 把英文思考译成中文显示。默认关：翻译会产生额外模型调用。 */
  translateReasoning: boolean;
  /** 翻译用的固定模型路由。 */
  translatorProvider: string;
  translatorModel: string;
  /** 思考卡片显示原文而不是译文。 */
  reasoningOriginal: boolean;
  /** 每次翻译追加到系统提示词后的自定义要求。 */
  translatorPrompt: string;
  /** 过程内容默认展开：即使开着自动折叠，也把当前轮次的过程摊开。 */
  autoExpand: boolean;
  /** 思考卡片自动跟随最新文字；关掉后停在当前位置由你自己滚。 */
  autoFollow: boolean;
}
type ReaderActions = {
  setExpanded: (draft: ReaderState, key: string, value: boolean) => void;
  resetExpanded: (draft: ReaderState) => void;
  setMotion: (draft: ReaderState, value: boolean) => void;
  setAutoFold: (draft: ReaderState, value: boolean) => void;
  setDeliverableOpenMode: (draft: ReaderState, value: DeliverableOpenMode) => void;
  setFoldIntensity: (draft: ReaderState, value: FoldIntensity) => void;
  setFrostedGlass: (draft: ReaderState, value: boolean) => void;
  setTranslateReasoning: (draft: ReaderState, value: boolean) => void;
  setTranslatorRoute: (draft: ReaderState, route: TranslatorRoute) => void;
  setReasoningOriginal: (draft: ReaderState, value: boolean) => void;
  setTranslatorPrompt: (draft: ReaderState, value: string) => void;
  setAutoExpand: (draft: ReaderState, value: boolean) => void;
  setAutoFollow: (draft: ReaderState, value: boolean) => void;
};

function applyFoldIntensity(draft: ReaderState, value: FoldIntensity): void {
  draft.foldIntensity = value;
  draft.autoFold = autoFoldFromIntensity(value);
  draft.processOnly = processOnlyFromIntensity(value);
}

export function createReaderStore(): EngineStoreHandle<ReaderState, ReaderActions> {
  return defineStore({
    init: (): ReaderState => ({
      expanded: {},
      motion: true,
      autoFold: true,
      deliverableOpenMode: 'external',
      foldIntensity: FOLD_INTENSITY_DEFAULT,
      frostedGlass: false,
      processOnly: false,
      translateReasoning: false,
      translatorProvider: '',
      translatorModel: '',
      reasoningOriginal: false,
      translatorPrompt: '',
      autoExpand: false,
      autoFollow: true,
    }),
    persist: 'dsh.reader.v1',
    actions: {
      setExpanded: (draft, key: string, value: boolean) => { draft.expanded[key] = value; },
      resetExpanded: draft => { draft.expanded = {}; },
      setMotion: (draft, value: boolean) => { draft.motion = value; },
      setAutoFold: (draft, value: boolean) => {
        applyFoldIntensity(draft, value
          ? (draft.foldIntensity === 2 ? 2 : 1)
          : 0);
      },
      setDeliverableOpenMode: (draft, value: DeliverableOpenMode) => { draft.deliverableOpenMode = value; },
      setFoldIntensity: (draft, value: FoldIntensity) => { applyFoldIntensity(draft, value); },
      setFrostedGlass: (draft, value: boolean) => { draft.frostedGlass = value; },
      setTranslateReasoning: (draft, value: boolean) => { draft.translateReasoning = value; },
      setTranslatorRoute: (draft, route: TranslatorRoute) => {
        draft.translatorProvider = route.provider;
        draft.translatorModel = route.model;
      },
      setReasoningOriginal: (draft, value: boolean) => { draft.reasoningOriginal = value; },
      setTranslatorPrompt: (draft, value: string) => { draft.translatorPrompt = value; },
      setAutoExpand: (draft, value: boolean) => { draft.autoExpand = value; },
      setAutoFollow: (draft, value: boolean) => { draft.autoFollow = value; },
    },
  });
}
