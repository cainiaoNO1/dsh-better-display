import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import semver from 'semver';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  main: string;
  scripts?: { prepare?: string };
  exports: Record<string, { default?: string } | string>;
  files: string[];
  dsh: { bundle?: { patch?: string } };
  peerDependencies: Record<string, string>;
};

const HARNESS_PEER = '>=0.2.0-rc.1 <0.2.1';

test('Harness 0.2.0 peer range accepts the rc.1 and stable releases', () => {
  const peers = Object.entries(pkg.peerDependencies).filter(([name]) => name.startsWith('@deepseek-ai/dsh-'));
  assert.ok(peers.length >= 12);
  for (const [name, range] of peers) {
    assert.equal(range, HARNESS_PEER, name);
    assert.equal(semver.satisfies('0.2.0-rc.2', range), true, name);
    assert.equal(semver.satisfies('0.2.0', range), true, name);
    assert.equal(semver.satisfies('0.2.0-alpha.1', range), false, name);
    assert.equal(semver.satisfies('0.2.0-alpha', range), false, name);
    assert.equal(semver.satisfies('0.1.7-rc.2', range), false, name);
  }
});

test('declares dsh.bundle.patch so official add joins the profile layer stack', () => {
  assert.equal(pkg.dsh.bundle?.patch, './cordis.patch.yml');
  assert.equal(existsSync(resolve(root, 'cordis.patch.yml')), true);
  const patch = readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8');
  assert.match(patch, /id: dsh-better-display/);
  assert.match(patch, /name: dsh-better-display/);
  assert.equal(pkg.files.includes('cordis.patch.yml'), true);
});

test('commits compiled lib entries and does not require a prepare script', () => {
  assert.equal(pkg.scripts?.prepare, undefined);
  assert.equal(pkg.main, 'lib/dsh-better-display.js');
  const client = pkg.exports['./client'];
  assert.equal(typeof client === 'object' && client !== null ? client.default : client, './lib/client.js');
  assert.equal(existsSync(resolve(root, 'lib/dsh-better-display.js')), true);
  assert.equal(existsSync(resolve(root, 'lib/client.js')), true);
  const clientJs = readFileSync(resolve(root, 'lib/client.js'), 'utf8');
  assert.match(clientJs, /window\.__ModuleLoader__\.load/);
  assert.match(clientJs, /id:\s*"dsh-better-display"/);
  assert.match(clientJs, /settings\.section/);
  assert.match(clientJs, /deliverableOpenMode/);
  assert.match(clientJs, /frostedGlass/);
  assert.match(clientJs, /foldIntensity/);
  assert.match(clientJs, /setFrostedGlass/);
  assert.match(clientJs, /setFoldIntensity/);
  assert.match(clientJs, /data-reader-glass/);
  assert.match(clientJs, /modeFromSnapshot/);
  assert.match(clientJs, /str_replace_editor/);
  assert.doesNotMatch(clientJs, /只折叠过程/);
  assert.match(clientJs, /\.dsh\/skills/);
  assert.doesNotMatch(clientJs, /submission\.images\.length/);
});

test('README documents the self-maintained build and link install', () => {
  const text = readFileSync(resolve(root, 'README.md'), 'utf8');
  assert.match(text, /npm run build/);
  assert.match(text, /dsh plugin --profile web add link:/);
  assert.match(text, /esbuild/);
  assert.match(text, /lightningcss/);
  assert.doesNotMatch(text, /activate-new-client/);
  assert.doesNotMatch(text, /DSHX_HARNESS/);
});

test('compiled client bundle carries the reasoning translation feature', () => {
  const clientJs = readFileSync(resolve(root, 'lib/client.js'), 'utf8');
  assert.match(clientJs, /better-display\/translate-reasoning/);
  assert.match(clientJs, /translateReasoning/);
  assert.match(clientJs, /setTranslatorRoute/);
  assert.match(clientJs, /data-reasoning-translation/);
  const hostJs = readFileSync(resolve(root, 'lib/dsh-better-display.js'), 'utf8');
  assert.match(hostJs, /better-display\/translate-reasoning/);
  assert.match(hostJs, /better-display\/translation-models/);
});
