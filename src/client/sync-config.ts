import type { OpenPrefs } from './SettingsSection.js';

export interface PersistentConfigDto {
  translateReasoning?: boolean;
  translatorProvider?: string;
  translatorModel?: string;
  translatorPrompt?: string;
  translatorMaxChars?: number;
  autoFold?: boolean;
  autoExpand?: boolean;
  autoFollow?: boolean;
}

/** 从宿主拉取持久化配置，补齐到前端 store（解决重启、换端口或空 localStorage 导致的配置回退）。 */
export function rehydrateFromHost(prefs: OpenPrefs): void {
  void fetch('/better-display/config')
    .then(res => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then((data: { ok?: boolean; config?: PersistentConfigDto }) => {
      if (!data?.ok || !data.config) return;
      const c = data.config;
      if (typeof c.translateReasoning === 'boolean') {
        prefs.actions.setTranslateReasoning?.(c.translateReasoning);
      }
      if (c.translatorProvider && c.translatorModel) {
        prefs.actions.setTranslatorRoute?.({
          provider: c.translatorProvider,
          model: c.translatorModel,
        });
      }
      if (typeof c.translatorPrompt === 'string') {
        prefs.actions.setTranslatorPrompt?.(c.translatorPrompt);
      }
      if (typeof c.translatorMaxChars === 'number') {
        prefs.actions.setTranslatorMaxChars?.(c.translatorMaxChars);
      }
      if (typeof c.autoFold === 'boolean') {
        prefs.actions.setAutoFold?.(c.autoFold);
      }
      if (typeof c.autoExpand === 'boolean') {
        prefs.actions.setAutoExpand?.(c.autoExpand);
      }
      if (typeof c.autoFollow === 'boolean') {
        prefs.actions.setAutoFollow?.(c.autoFollow);
      }
    })
    .catch(() => {});
}

/** 监听配置变更，异步同步写入宿主磁盘。 */
export function syncConfigToHost(prefs: OpenPrefs): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastSaved = '';
  return prefs.subscribe(() => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      const snap = prefs.getSnapshot();
      if (!snap) return;
      const payload: PersistentConfigDto = {
        translateReasoning: snap.translateReasoning,
        translatorProvider: snap.translatorProvider,
        translatorModel: snap.translatorModel,
        translatorPrompt: snap.translatorPrompt,
        translatorMaxChars: snap.translatorMaxChars,
        autoFold: snap.autoFold,
        autoExpand: snap.autoExpand,
        autoFollow: snap.autoFollow,
      };
      const serialized = JSON.stringify(payload);
      if (serialized === lastSaved) return;
      lastSaved = serialized;
      fetch('/better-display/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: serialized,
      }).catch(() => {});
    }, 400);
  });
}
