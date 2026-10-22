import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import css from './Reader.module.css';

/**
 * 阅读视图的四个全局开关。
 *
 * 它们写进根 store 的 `dsh.reader.v1`，所以对所有会话生效、刷新后仍在。
 *
 * 渲染位置：官方把「阅读 / 对话 / 轨迹」这一行渲染在 `[data-conversation-tabs]`
 * 里，且没有为它声明插槽，所以这里用 portal 挂进那一行、靠 `margin-left:auto`
 * 顶到最右。这样不会和 `conversation.session.header.corner`（右侧边栏按钮）或
 * 其它插件往 `conversation.session.header.actions` 里塞的按钮抢位置。
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
  onToggle: (value: boolean) => void;
}

function ToolbarSwitch({ spec }: { spec: SwitchSpec }) {
  return <button
    type="button"
    className={css.toolbarSwitch}
    role="switch"
    aria-checked={spec.on}
    data-on={spec.on || undefined}
    data-reader-switch={spec.key}
    title={spec.title}
    onClick={() => spec.onToggle(!spec.on)}
  >
    <span className={css.toolbarSwitchDot} aria-hidden="true" />
    {spec.label}
  </button>;
}

const TABS_SELECTOR = '[data-conversation-tabs]';

/** 找到当前文档里的 tabs 行；官方在视图切换时会重建它，所以要跟着重找。 */
function useTabsHost(): HTMLElement | null {
  const [host, setHost] = useState<HTMLElement | null>(
    () => typeof document === 'undefined' ? null : document.querySelector<HTMLElement>(TABS_SELECTOR),
  );
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const find = () => {
      const next = document.querySelector<HTMLElement>(TABS_SELECTOR);
      setHost(current => (current === next ? current : next));
    };
    find();
    const observer = new MutationObserver(find);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { observer.disconnect(); };
  }, []);
  return host;
}

export function ReaderToolbar(props: ReaderToolbarProps) {
  const host = useTabsHost();
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
        ? '已开启：思考卡片默认就是展开阅读的状态。点一下关闭。'
        : '已关闭：思考卡片超过可视高度时折叠，需要点「展开阅读」。点一下让它默认展开。',
      onToggle: props.onToggleAutoExpand,
    },
    {
      key: 'translate',
      label: '自动翻译',
      on: props.translateOn,
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
  const group = <div className={css.toolbarGroup} data-reader-toolbar>
    {specs.map(spec => <ToolbarSwitch key={spec.key} spec={spec} />)}
  </div>;
  // 找不到 tabs 行（例如尚未进入会话）时不渲染，避免开关跑到页面别处。
  return host === null ? null : createPortal(group, host);
}
