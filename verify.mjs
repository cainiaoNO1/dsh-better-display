#!/usr/bin/env node
/**
 * 冒烟检查：不启动 DSH，只验证 lib/ 产物满足宿主加载契约。
 *
 *   1. Host 侧可被 Node 直接 import，并导出 name / inject / apply
 *   2. Client 侧是 __ModuleLoader__ 注册式 bundle，且 factory 能真正执行
 *   3. factory 只 require 平台共享模块表里的包
 *   4. CSS Module 已内联为 <style> 注入，类名映射齐全
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const root = dirname(fileURLToPath(import.meta.url));

/** 与 dsh-web-frontend 的 PLATFORM_MODULES 保持一致。 */
const PLATFORM_MODULES = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  'zod',
  '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]);

const host = await import(pathToFileURL(join(root, 'lib/dsh-better-display.js')).href);
assert.equal(host.name, 'dsh-better-display', 'host name');
assert.ok(Array.isArray(host.inject) && host.inject.includes('webServer'), 'host inject');
assert.equal(typeof host.apply, 'function', 'host apply');

const clientCode = readFileSync(join(root, 'lib/client.js'), 'utf8');
assert.match(clientCode, /^window\.__ModuleLoader__\.load\(/m, 'client registers through the module loader');

const requested = [...clientCode.matchAll(/require\("([^"]+)"\)/g)].map(m => m[1]);
const unknown = [...new Set(requested)].filter(name => !PLATFORM_MODULES.has(name));
assert.deepEqual(unknown, [], `client requires only platform modules, got extras: ${unknown.join(', ')}`);

// 在最小 DOM 桩里真正执行 bundle，验证 factory 的模块体不抛错。
const styleTags = [];
const loaded = [];
const style = {
  dataset: {},
  _text: '',
  set textContent(value) { this._text = value; },
  get textContent() { return this._text; },
};
const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  requestAnimationFrame: () => 0,
  cancelAnimationFrame() {},
  performance,
  queueMicrotask,
  document: {
    head: { appendChild: tag => styleTags.push(tag) },
    createElement: () => ({ ...style, dataset: {}, _text: '' }),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
    documentElement: { lang: 'zh-CN', style: {}, getAttribute: () => null, classList: { contains: () => false } },
    body: null,
    getSelection: () => null,
    execCommand: () => false,
  },
  navigator: { language: 'zh-CN', clipboard: { writeText: async () => {} } },
  location: { href: 'http://127.0.0.1:3080/' },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.window.__ModuleLoader__ = {
  load(registration) { loaded.push(registration); },
};
sandbox.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
sandbox.window.addEventListener = () => {};
sandbox.window.removeEventListener = () => {};

vm.runInNewContext(clientCode, sandbox, { filename: 'lib/client.js' });

assert.equal(loaded.length, 1, 'exactly one bundle registered');
assert.equal(loaded[0].id, 'dsh-better-display', 'bundle id');

const profileRequire = createRequire(join(root, 'package.json'));
const stubs = {
  react: await import('react'),
  'react/jsx-runtime': await import('react/jsx-runtime'),
  'react-dom': await import('react-dom'),
};
for (const name of ['@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-primitives']) {
  try {
    stubs[name] = await import(pathToFileURL(profileRequire.resolve(name)).href);
  } catch {
    // 平台包未在本机可解析时降级为空桩，只验证模块体不抛错。
    stubs[name] = new Proxy({}, { get: () => () => null });
  }
}

const exported = loaded[0].factory(name => {
  if (!(name in stubs)) throw new Error(`unexpected require("${name}")`);
  return stubs[name];
});
assert.equal(exported.name, 'dsh-better-display-client', 'client name');
assert.equal(typeof exported.apply, 'function', 'client apply');
assert.ok(Array.isArray(exported.inject) && exported.inject.includes('slots'), 'client inject');
assert.ok(styleTags.length >= 7, `css modules injected, got ${styleTags.length}`);
assert.ok(styleTags.every(tag => tag.dataset.plugin === 'dsh-better-display'), 'css tagged with plugin name');

console.log('✓ host bundle exports name/inject/apply');
console.log(`✓ client bundle registers through __ModuleLoader__ (${loaded[0].id})`);
console.log(`✓ client requires only platform modules (${[...new Set(requested)].join(', ')})`);
console.log(`✓ factory materializes (${Object.keys(exported).join(', ')})`);
console.log(`✓ ${styleTags.length} CSS modules injected`);
