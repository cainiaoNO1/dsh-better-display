import { useCallback, useSyncExternalStore } from 'react';
import type { ReaderProps } from './types.js';
import css from './Reader.module.css';

/**
 * 阅读视图右上角的四个全局开关。
 *
 * 它们都写进根 store 的 `dsh.reader.v1`，所以对所有会话生效、刷新后仍在。
 * 放在工具栏而不是设置面板，是因为这几个是「边读边调」的：想临时摊开过程、
 * 想停下自动跟随，都需要随手一点，不该跳去设置页。
 */
export interface ReaderToolbarProps {
  autoFold: boolean;
  onToggleAutoFold: (value: boolean) => void;
  autoExpand: boolean;
  onToggleAutoExpand: (value: boolean) => void;
  translateOn: boolean;
  /** 翻译没配好模型时为 true：开关能点，但会提示先去设置里选模型。 */
  translateReady: boolean;
  onToggleTranslate: (value: boolean) => void;
  autoFollow: boolean;
  onToggleAutoFollow: (value: boolean) => void;
}

interface SwitchSpec {
  key: string;
  label: string;
  on: boolean;
  title: string;
  disabled?: boolean;
  onToggle: (value: boolean) => void;
}

function ToolbarSwitch({ spec }: { spec: SwitchSpec }) {
  return <button
    type="button"
    className={css.toolbarSwitch}
    role="switch"
    aria-checked={spec.on}
    disabled={spec.disabled}
    data-on={spec.on || undefined}
    data-reader-switch={spec.key}
    title={spec.title}
    onClick={() => spec.onToggle(!spec.on)}
  >
    <span className={css.toolbarSwitchDot} aria-hidden="true" />
    {spec.label}
  </button>;
}

export function ReaderToolbar(props: ReaderToolbarProps) {
  const specs: SwitchSpec[] = [
    {
      key: 'auto-fold',
      label: '自动折叠',
      on: props.autoFold,
      title: props.autoFold
        ? '已开启：新思考产生时，把此前步骤收拢成一行汇总。点一下关闭，完整保留过程。'
        : '已关闭：过程内容始终完整展开。点一下开启自动折叠。',
      onToggle: props.onToggleAutoFold,
    },
    {
      key: 'auto-expand',
      label: '自动展开',
      on: props.autoExpand,
      title: props.autoExpand
        ? '已开启：即使开着自动折叠，当前轮次的过程也保持摊开。点一下关闭。'
        : '已关闭：过程按自动折叠的规则收拢。点一下让过程始终摊开。',
      onToggle: props.onToggleAutoExpand,
    },
    {
      key: 'translate',
      label: '自动翻译',
      on: props.translateOn,
      disabled: false,
      title: props.translateOn
        ? '已开启：正在输出的英文思考会译成中文。点一下关闭。'
        : props.translateReady
          ? '已关闭：点一下开启翻译。只翻你正看着的、正在输出的思考。'
          : '还没选翻译模型。先到 设置 → Better Display 选定一个模型，再回来打开。',
      onToggle: props.onToggleTranslate,
    },
    {
      key: 'auto-follow',
      label: '自动跟随',
      on: props.autoFollow,
      title: props.autoFollow
        ? '已开启：思考卡片自动滚到最新文字。点一下关闭，停在当前位置。'
        : '已关闭：思考卡片停在当前位置，由你自己滚。点一下恢复自动跟随。',
      onToggle: props.onToggleAutoFollow,
    },
  ];
  return <div className={css.toolbarGroup} data-reader-toolbar>
    {specs.map(spec => <ToolbarSwitch key={spec.key} spec={spec} />)}
  </div>;
}

/** 从 Reader 的 prefs/store 里读出四个开关并接上写入动作。 */
export function useReaderToolbar(props: ReaderProps, autoFold: boolean, autoFoldWrite: (value: boolean) => void): {
  toolbar: ReaderToolbarProps;
} {
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
