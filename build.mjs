#!/usr/bin/env node
/**
 * dsh-better-display 自用构建脚本。
 *
 * 复刻 DeepSeek Harness 客户端插件的加载契约，不依赖官方 dshx 构建工具：
 *   - lib/dsh-better-display.js —— Host 侧 ESM 入口（Node 直接 import）
 *   - lib/client.js           —— 浏览器侧 bundle，用 window.__ModuleLoader__.load 注册
 *
 * 关键点：客户端 bundle 里的 CSS Module 被编译成「注入 <style> + 导出 class 映射」，
 * 并且保持 `//#region \0dshx-css-module:<name>.mjs` 这类 region 注释的原始格式，
 * 以便与官方产物结构一致、便于对照排查。
 *
 * 用法：
 *   node build.mjs           一次性构建
 *   node build.mjs --watch   监听源码增量构建
 */
import { build, context } from 'esbuild';
import { transform } from 'lightningcss';
import { readFileSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const libDir = join(root, 'lib');
const watch = process.argv.includes('--watch');

/**
 * 这些模块由浏览器宿主的共享模块表提供，不能打进 bundle。
 * 与官方产物的 require() 集合一致，多一个少一个都会在宿主里解析失败。
 */
const PLATFORM_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-primitives',
];

/**
 * CSS Module 插件：lightningcss 计算作用域类名并压缩，输出与官方 dshx 一致的
 * 注入片段。`[hash]_[local]` 的 hash 取文件路径，因此同一文件跨构建稳定。
 */
const cssModulePlugin = {
  name: 'dshx-css-module',
  setup(b) {
    b.onLoad({ filter: /\.module\.css$/ }, args => {
      const source = readFileSync(args.path, 'utf8');
      const { code, exports } = transform({
        filename: args.path,
        code: Buffer.from(source),
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
        errorRecovery: true,
      });
      const name = args.path.split(/[\\/]/).pop();
      const tagId = `dsh-better-display/${name}`;
      const mapping = Object.fromEntries(
        Object.entries(exports).map(([local, info]) => [local, info.name]),
      );
      const contents = [
        `//#region \\0dshx-css-module:${name}.mjs`,
        `const css = ${JSON.stringify(code.toString())};`,
        `const tagId = ${JSON.stringify(tagId)};`,
        'if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {',
        '\tconst tag = document.createElement("style");',
        '\ttag.dataset.plugin = "dsh-better-display";',
        '\ttag.dataset.pluginCss = tagId;',
        '\ttag.textContent = css;',
        '\tdocument.head.appendChild(tag);',
        '}',
        `export default ${JSON.stringify(mapping)};`,
        '//#endregion',
      ].join('\n');
      return { contents, loader: 'js', resolveDir: dirname(args.path) };
    });
  },
};

/** 客户端 bundle 的包装：注册 factory，模块体延迟到首次 materialize 才执行。 */
const moduleLoaderPlugin = {
  name: 'dshx-module-loader',
  setup(b) {
    b.onEnd(result => {
      if (result.errors.length > 0) return;
      for (const output of result.outputFiles ?? []) {
        if (!output.path.endsWith('client.js')) continue;
        const body = output.text;
        output.contents = Buffer.from(
          [
            'window.__ModuleLoader__.load({',
            '\tid: "dsh-better-display",',
            '\tfactory: (require) => {',
            '\t\tvar module = { exports: {} };',
            '\t\tvar exports = module.exports;',
            '\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
            body,
            '\t\treturn module.exports;',
            '\t}',
            '});',
            '',
          ].join('\n'),
        );
      }
    });
  },
};

const common = {
  bundle: true,
  format: 'cjs',
  target: 'es2022',
  logLevel: 'info',
  legalComments: 'none',
  write: false,
  external: PLATFORM_EXTERNALS,
};

const hostConfig = {
  ...common,
  entryPoints: [join(root, 'src/dsh-better-display.ts')],
  outfile: join(libDir, 'dsh-better-display.js'),
  platform: 'node',
  format: 'esm',
  packages: 'external',
  external: [],
};

const clientConfig = {
  ...common,
  entryPoints: [join(root, 'src/client/index.tsx')],
  outfile: join(libDir, 'client.js'),
  platform: 'browser',
  jsx: 'automatic',
  loader: { '.ts': 'ts', '.tsx': 'tsx' },
  plugins: [cssModulePlugin, moduleLoaderPlugin],
  define: { 'process.env.NODE_ENV': '"production"' },
};

function emit(result) {
  for (const output of result.outputFiles) {
    mkdirSync(dirname(output.path), { recursive: true });
    writeFileSync(output.path, output.contents);
    console.log(`  ✓ ${output.path.replace(`${root}/`, '')}  ${(output.contents.length / 1024).toFixed(1)} KB`);
  }
}

async function runOnce() {
  rmSync(libDir, { recursive: true, force: true });
  console.log('building host bundle…');
  emit(await build(hostConfig));
  console.log('building client bundle…');
  emit(await build(clientConfig));
  if (!existsSync(join(libDir, 'client.js'))) throw new Error('client.js 未生成');
  console.log('done.');
}

async function runWatch() {
  rmSync(libDir, { recursive: true, force: true });
  const host = await context({
    ...hostConfig,
    plugins: [
      ...(hostConfig.plugins ?? []),
      {
        name: 'emit-host',
        setup(b) {
          b.onEnd(r => {
            if (r.errors.length === 0) emit(r);
          });
        },
      },
    ],
  });
  const client = await context({
    ...clientConfig,
    plugins: [
      ...clientConfig.plugins,
      {
        name: 'emit-client',
        setup(b) {
          b.onEnd(r => {
            if (r.errors.length === 0) emit(r);
          });
        },
      },
    ],
  });
  await host.watch();
  await client.watch();
  console.log('watching src/ … (Ctrl+C 退出)');
}

await (watch ? runWatch() : runOnce());
