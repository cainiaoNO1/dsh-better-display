import { useCallback, useSyncExternalStore } from 'react';
import type { ReaderProps } from './types.js';
import type { ReaderToolbarProps } from './ReaderToolbar.js';

/**
 * 从 Reader 的 prefs/store 里读出四个开关，并接上写入动作。
 *
 * 读的时候优先用根 prefs（所有会话共用、可持久化），回落到会话 store；
 * 写的时候两处都写，这样从设置面板改也能同步。
 */
export function useReaderToolbar(
  props: ReaderProps,
  autoFold: boolean,
  autoFoldWrite: (value: boolean) => void,
): { toolbar: ReaderToolbarProps } {
  const prefs = props.openPrefs;
  const prefsSnap = useSyncExternalStore(
    prefs?.subscribe ?? ((fn: () => void) => { void fn; return () => {}; }),
    () => prefs?.getSnapshot?.(),
    () => undefined,
  );
  const storeAutoExpand = props.useStore(state => state.autoExpand);
  const storeAutoFollow = props.useStore(state => state.autoFollow);
  const autoExpand = prefsSnap?.autoExpand ?? storeAutoExpand ?? false;
  const autoFollow = prefsSnap?.autoFollow ?? storeAutoFollow ?? true;
  const translateOn = prefsSnap?.translateReasoning === true;
  const translateReady = !!prefsSnap?.translatorProvider && !!prefsSnap?.translatorModel;

  const write = useCallback((key: 'setAutoExpand' | 'setAutoFollow' | 'setTranslateReasoning', value: boolean) => {
    prefs?.actions?.[key]?.(value);
  }, [prefs]);

  return {
    toolbar: {
      autoFold,
      onToggleAutoFold: autoFoldWrite,
      autoExpand,
      onToggleAutoExpand: value => { write('setAutoExpand', value); },
      translateOn,
      translateReady,
      onToggleTranslate: value => { write('setTranslateReasoning', value); },
      autoFollow,
      onToggleAutoFollow: value => { write('setAutoFollow', value); },
    },
  };
}
