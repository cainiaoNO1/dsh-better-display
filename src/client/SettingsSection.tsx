import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { foldIntensityOf, frostedGlassOf, type FoldIntensity } from './fold-intensity.js';
import { deliverableOpenModeOf, type DeliverableOpenMode } from './open-file.js';
import { settingsCopyFor, type SettingsCopy, type SettingsCopyKey } from './settings-copy.js';
import { CONVENTIONAL_SKILL_ROOTS, detectGenerativeMcpappsSkill, shortestInstallCommand, type SkillStatusProbe, type SkillStatusSnapshot } from './skill-status.js';
import css from './SettingsSection.module.css';

export interface ReaderPrefsSnapshot {
  deliverableOpenMode?: DeliverableOpenMode;
  frostedGlass?: boolean;
  foldIntensity?: FoldIntensity;
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
}

export interface OpenPrefs {
  getSnapshot: () => ReaderPrefsSnapshot;
  subscribe: (fn: () => void) => () => void;
  actions: {
    setDeliverableOpenMode: (value: DeliverableOpenMode) => void;
    setFrostedGlass: (value: boolean) => void;
    setFoldIntensity?: (value: FoldIntensity) => void;
    setAutoFold?: (value: boolean) => void;
    setTranslateReasoning?: (value: boolean) => void;
    setTranslatorRoute?: (route: { provider: string; model: string }) => void;
    setTranslatorPrompt?: (value: string) => void;
    setTranslatorMaxChars?: (value: number) => void;
    setReasoningOriginal?: (value: boolean) => void;
    setAutoExpand?: (value: boolean) => void;
    setAutoFollow?: (value: boolean) => void;
  };
}

export interface BetterDisplaySettingsInjected {
  prefs: OpenPrefs;
  copy?: SettingsCopy;
  languageTag?: string;
  checkSkill: SkillStatusProbe;
}

/** 宿主 `/better-display/translation-models` 的响应形状。 */
interface ModelRoute {
  id: string;
  name: string;
  models: { id: string; name: string }[];
}

type SettingsProps = BetterDisplaySettingsInjected & {
  /** Official settings.section owner share; unused here. */
  close?: () => void;
  t?: (key: SettingsCopyKey) => string;
};

function text(props: SettingsProps, copy: SettingsCopy, key: keyof SettingsCopy): string {
  if (typeof props.t === 'function') {
    try {
      const value = props.t(key);
      if (typeof value === 'string' && value.length > 0 && value !== key) return value;
    } catch {
      // Fall through to the bundled dictionaries.
    }
  }
  return copy[key];
}

const FOLD_STOPS: { value: FoldIntensity; key: 'foldNone' | 'foldStandard' | 'foldSummary' }[] = [
  { value: 0, key: 'foldNone' },
  { value: 1, key: 'foldStandard' },
  { value: 2, key: 'foldSummary' },
];

export function SettingsSection(props: SettingsProps) {
  const copy = props.copy ?? settingsCopyFor(props.languageTag);
  const snap = useSyncExternalStore(
    props.prefs.subscribe,
    () => props.prefs.getSnapshot() ?? ({} as ReaderPrefsSnapshot),
    () => ({} as ReaderPrefsSnapshot),
  );
  const mode = deliverableOpenModeOf(snap.deliverableOpenMode);
  const glass = frostedGlassOf(snap);
  const autoFold = snap.autoFold !== false && snap.foldIntensity !== 0;
  const setMode = (value: DeliverableOpenMode) => {
    props.prefs.actions.setDeliverableOpenMode(value);
  };
  const on = mode === 'sidebar';
  const [skill, setSkill] = useState<SkillStatusSnapshot | undefined>();
  const [checking, setChecking] = useState(false);
  const [routes, setRoutes] = useState<ModelRoute[] | undefined>();
  const [routeError, setRouteError] = useState<string | undefined>();
  const [loadingRoutes, setLoadingRoutes] = useState(false);

  const translateOn = snap.translateReasoning === true;
  const translatorProvider = snap.translatorProvider ?? '';
  const translatorModel = snap.translatorModel ?? '';
  const translatorPrompt = snap.translatorPrompt ?? '';
  const translatorMaxChars = snap.translatorMaxChars ?? 12000;
  const autoExpand = snap.autoExpand === true;
  const autoFollow = snap.autoFollow !== false;
  // 输入框保持本地状态：每次按键都写 store 会让整棵树重渲染，中文输入法还容易丢字。
  const [promptDraft, setPromptDraft] = useState(translatorPrompt);
  useEffect(() => { setPromptDraft(translatorPrompt); }, [translatorPrompt]);
  const [maxCharsDraft, setMaxCharsDraft] = useState(String(translatorMaxChars));
  useEffect(() => { setMaxCharsDraft(String(translatorMaxChars)); }, [translatorMaxChars]);

  const loadRoutes = useCallback(async () => {
    setLoadingRoutes(true);
    setRouteError(undefined);
    try {
      const response = await fetch('/better-display/translation-models');
      const payload = await response.json() as { ok?: boolean; providers?: ModelRoute[]; error?: string };
      if (!response.ok || !payload?.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`);
      setRoutes(payload.providers ?? []);
    } catch (error) {
      setRoutes(undefined);
      setRouteError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingRoutes(false);
    }
  }, []);

  // 只有真的要用翻译时才去问宿主，避免每次打开设置都打一次请求。
  useEffect(() => {
    if (translateOn && routes === undefined && !loadingRoutes && !routeError) void loadRoutes();
  }, [translateOn, routes, loadingRoutes, routeError, loadRoutes]);

  const recheck = useCallback(async () => {
    setChecking(true);
    try {
      setSkill(await detectGenerativeMcpappsSkill(props.checkSkill));
    } catch {
      setSkill({
        name: 'generative-mcpapps',
        installed: false,
        via: null,
        roots: [],
        hostReached: false,
      });
    } finally {
      setChecking(false);
    }
  }, [props.checkSkill]);

  useEffect(() => { void recheck(); }, [recheck]);

  return (
    <div className={css.section} data-better-display-settings>
      <div className={css.row}>
        <div className={css.rowText}>
          <div className={css.title}>{text(props, copy, 'openTitle')}</div>
          <div className={css.desc}>{text(props, copy, 'openDescription')}</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          className={css.switch}
          data-on={on || undefined}
          data-better-display-open-mode={mode}
          onClick={() => { setMode(on ? 'external' : 'sidebar'); }}
        />
      </div>

      <div className={css.row}>
        <div className={css.rowText}>
          <div className={css.title}>{text(props, copy, 'glassTitle')}</div>
          <div className={css.desc}>{text(props, copy, 'glassDescription')}</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={glass}
          className={css.switch}
          data-on={glass || undefined}
          data-better-display-glass={glass ? 'on' : 'off'}
          onClick={() => { props.prefs.actions.setFrostedGlass(!glass); }}
        />
      </div>

      <div className={css.row}>
        <div className={css.rowText}>
          <div className={css.title}>{text(props, copy, 'foldTitle')}</div>
          <div className={css.desc}>{text(props, copy, 'foldDescription')}</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={autoFold}
          className={css.switch}
          data-on={autoFold || undefined}
          data-better-display-auto-fold={autoFold ? 'on' : 'off'}
          onClick={() => {
            props.prefs.actions.setAutoFold?.(!autoFold);
            props.prefs.actions.setFoldIntensity?.(!autoFold ? 1 : 0);
          }}
        />
      </div>

      <div className={css.row}>
        <div className={css.rowText}>
          <div className={css.title}>{text(props, copy, 'autoExpandTitle')}</div>
          <div className={css.desc}>{text(props, copy, 'autoExpandDescription')}</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={autoExpand}
          className={css.switch}
          data-on={autoExpand || undefined}
          data-better-display-auto-expand={autoExpand ? 'on' : 'off'}
          onClick={() => { props.prefs.actions.setAutoExpand?.(!autoExpand); }}
        />
      </div>

      <div className={css.row}>
        <div className={css.rowText}>
          <div className={css.title}>{text(props, copy, 'autoFollowTitle')}</div>
          <div className={css.desc}>{text(props, copy, 'autoFollowDescription')}</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={autoFollow}
          className={css.switch}
          data-on={autoFollow || undefined}
          data-better-display-auto-follow={autoFollow ? 'on' : 'off'}
          onClick={() => { props.prefs.actions.setAutoFollow?.(!autoFollow); }}
        />
      </div>

      <section className={css.block} data-better-display-translate={translateOn ? 'on' : 'off'}>
        <div className={css.row}>
          <div className={css.rowText}>
            <div className={css.title}>{text(props, copy, 'translateTitle')}</div>
            <div className={css.desc}>{text(props, copy, 'translateDescription')}</div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={translateOn}
            className={css.switch}
            data-on={translateOn || undefined}
            data-better-display-translate-switch={translateOn ? 'on' : 'off'}
            onClick={() => { props.prefs.actions.setTranslateReasoning?.(!translateOn); }}
          />
        </div>
        {translateOn && (
          <div className={css.routeRow} data-better-display-translate-route>
            <span className={css.routeLabel}>{text(props, copy, 'translateRoute')}</span>
            <select
              className={css.select}
              aria-label={text(props, copy, 'translateRoute')}
              value={translatorProvider && translatorModel ? `${translatorProvider}\u0000${translatorModel}` : ''}
              disabled={loadingRoutes || !routes || routes.length === 0}
              onChange={event => {
                const [provider = '', model = ''] = event.target.value.split('\u0000');
                props.prefs.actions.setTranslatorRoute?.({ provider, model });
              }}
            >
              <option value="">—</option>
              {(routes ?? []).flatMap(route => route.models.length > 0
                ? route.models.map(model => (
                  <option key={`${route.id}\u0000${model.id}`} value={`${route.id}\u0000${model.id}`}>
                    {route.name} · {model.name}
                  </option>
                ))
                : [(
                  <option key={`${route.id}\u0000`} value={`${route.id}\u0000`} disabled>
                    {route.name} · 无可用模型
                  </option>
                )])}
            </select>
            <button type="button" className={css.button} disabled={loadingRoutes} onClick={() => { void loadRoutes(); }}>
              {loadingRoutes ? text(props, copy, 'skillChecking') : text(props, copy, 'translateReload')}
            </button>
            {routeError && <p className={css.desc}>{text(props, copy, 'translateLoadFailed')} {routeError}</p>}
            {!routeError && routes && routes.every(route => route.models.length === 0) && (
              <p className={css.desc}>{text(props, copy, 'translateNoModels')}</p>
            )}
          </div>
        )}
        {translateOn && (
          <div className={css.promptRow} data-better-display-translate-prompt>
            <label className={css.promptLabel} htmlFor="better-display-translate-prompt">
              {text(props, copy, 'translatePrompt')}
            </label>
            <textarea
              id="better-display-translate-prompt"
              className={css.promptInput}
              rows={3}
              spellCheck={false}
              value={promptDraft}
              placeholder={text(props, copy, 'translatePromptPlaceholder')}
              onChange={event => { setPromptDraft(event.target.value); }}
              // 失焦才落盘：翻译请求依赖它，但没必要每个字符都触发一次 store 更新。
              onBlur={() => {
                if (promptDraft !== translatorPrompt) props.prefs.actions.setTranslatorPrompt?.(promptDraft);
              }}
            />
          </div>
        )}
        {translateOn && (
          <div className={css.maxCharsRow} data-better-display-translate-max-chars>
            <div className={css.maxCharsHeader}>
              <label className={css.promptLabel} htmlFor="better-display-translate-max-chars">
                {text(props, copy, 'translateMaxCharsTitle')}
              </label>
              <div className={css.desc}>{text(props, copy, 'translateMaxCharsDescription')}</div>
            </div>
            <div className={css.maxCharsInputRow}>
              <div className={css.numberWrapper}>
                <input
                  id="better-display-translate-max-chars"
                  type="number"
                  min={1000}
                  max={100000}
                  step={1000}
                  className={css.numberInput}
                  value={maxCharsDraft}
                  onChange={event => { setMaxCharsDraft(event.target.value); }}
                  onBlur={event => {
                    const parsed = parseInt(event.target.value, 10);
                    const valid = Number.isFinite(parsed) && parsed >= 1000 ? Math.min(100000, parsed) : 12000;
                    setMaxCharsDraft(String(valid));
                    if (valid !== translatorMaxChars) {
                      props.prefs.actions.setTranslatorMaxChars?.(valid);
                    }
                  }}
                />
                <span className={css.numberUnit}>字符</span>
              </div>
              <div className={css.presets}>
                {[6000, 12000, 25000, 50000].map(val => (
                  <button
                    key={val}
                    type="button"
                    className={css.presetButton}
                    data-active={parseInt(maxCharsDraft, 10) === val || undefined}
                    onClick={() => {
                      setMaxCharsDraft(String(val));
                      if (val !== translatorMaxChars) {
                        props.prefs.actions.setTranslatorMaxChars?.(val);
                      }
                    }}
                  >
                    {val === 12000 ? `${val} (默认)` : val}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      <section className={css.block} data-better-display-skill={skill?.installed ? 'installed' : 'missing'}>
        <div className={css.title}>{text(props, copy, 'skillTitle')}</div>
        <div className={css.status}>
          <span className={css.badge} data-ok={skill?.installed || undefined}>
            {skill?.installed ? text(props, copy, 'skillInstalled') : text(props, copy, 'skillMissing')}
          </span>
        </div>
        <p className={css.desc}>{text(props, copy, 'skillPurpose')}</p>
        <p className={css.desc}>{text(props, copy, 'skillPluginNote')}</p>
        {skill && !skill.installed ? (
          <>
            <p className={css.desc}>{skill.hostReached ? text(props, copy, 'skillInstall') : text(props, copy, 'skillUnavailable')}</p>
            <pre className={css.pre}>{shortestInstallCommand()}</pre>
            <ul className={css.roots} data-better-display-skill-roots>
              {CONVENTIONAL_SKILL_ROOTS.map(root => (
                <li key={root}>{root}</li>
              ))}
            </ul>
          </>
        ) : null}
        <div className={css.actions}>
          <button type="button" className={css.button} disabled={checking} onClick={() => { void recheck(); }}>
            {checking ? text(props, copy, 'skillChecking') : text(props, copy, 'skillRecheck')}
          </button>
        </div>
      </section>
    </div>
  );
}
