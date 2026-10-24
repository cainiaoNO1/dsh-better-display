import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface BetterDisplayPersistentConfig {
  translateReasoning?: boolean;
  translatorProvider?: string;
  translatorModel?: string;
  translatorPrompt?: string;
  translatorMaxChars?: number;
  autoFold?: boolean;
  autoExpand?: boolean;
  autoFollow?: boolean;
}

const CONFIG_DIR = join(homedir(), '.dsh', 'dsh-better-display');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export function loadPersistentConfig(customFile = CONFIG_FILE): BetterDisplayPersistentConfig {
  try {
    if (!existsSync(customFile)) return {};
    const raw = readFileSync(customFile, 'utf8');
    return JSON.parse(raw) as BetterDisplayPersistentConfig;
  } catch {
    return {};
  }
}

export function savePersistentConfig(
  patch: Partial<BetterDisplayPersistentConfig>,
  customFile = CONFIG_FILE,
): BetterDisplayPersistentConfig {
  try {
    const dir = customFile.slice(0, customFile.lastIndexOf('/'));
    if (dir) mkdirSync(dir, { recursive: true });
    const current = loadPersistentConfig(customFile);
    const next = { ...current, ...patch };
    writeFileSync(customFile, JSON.stringify(next, null, 2), 'utf8');
    return next;
  } catch (err) {
    console.error('Failed to save dsh-better-display persistent config:', err);
    return loadPersistentConfig(customFile);
  }
}
