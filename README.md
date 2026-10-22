# dsh-better-display（自用维护版）

> DeepSeek Harness Web GUI 的「阅读」视图插件。本仓库是在上游
> [`aa2246740/dsh-better-display`](https://github.com/aa2246740/dsh-better-display)
> `v0.3.6` 基础上分叉出来的**个人自用维护版**：替换掉官方 DSHX 构建链，
> 改成可独立复现的 esbuild + lightningcss 构建，并作为本地插件长期迭代。

给 Harness 加一个 **阅读** 页签：执行时能看到步骤、思考和进度；整轮成功结束后把过程收起来，
只留下最终回答。原版「对话 / 轨迹」、输入框、模型选择、工具与审批全部保留。

---

## 一、这个仓库解决什么

| 能力 | 说明 |
| --- | --- |
| **阅读视图** | 独立页签，聚焦最终回答，过程按轮次折叠 |
| **思考卡片** | 实时跟随滚动、暂停/继续跟随、展开完整阅读、可手动滚轮接管 |
| **过程折叠** | 三档强度（不折叠 / 标准折叠 / 过程摘要），默认开启 |
| **毛玻璃** | 可选半透明背景，默认关闭 |
| **产物打开方式** | 系统应用（默认）或右侧栏预览 |
| **mcp-app 卡片** | 最终回答里的 ````mcp-app` 代码块挂成沙箱 iframe 交互卡片，可把下一轮 prompt 回填输入框 |
| **官方能力接入** | 反馈、工具详情、文件卡片、文件链接走官方 slot，不自造轮子 |

## 二、构建方式（已脱离 DSHX）

上游用官方 `dshx` 工具链构建客户端 bundle，那套工具不随 npm 发布，本机难以复现。
本仓库用 `build.mjs` 直接产出宿主可加载的产物：

```sh
npm install --legacy-peer-deps   # 官方 @deepseek-ai/dsh-* 包互相锁版本，必须忽略 peer 冲突
npm run build                    # → lib/dsh-better-display.js + lib/client.js
npm run verify                   # 冒烟：产物满足宿主加载契约
```

`build.mjs` 做了三件上游 tsdown 配置在做的事：

1. **CSS Module 编译**：`lightningcss` 按 `[hash]_[local]` 生成作用域类名并压缩，
   输出「注入 `<style data-plugin-css>` + 导出类名映射」的模块，与官方产物结构一致。
2. **Client bundle 包装**：用 `window.__ModuleLoader__.load({ id, factory })` 注册，
   模块体保持惰性，首次 materialize 才执行（CSS 注入因此也在那时发生）。
3. **平台外部化**：只把 `react`、`react/jsx-runtime`、`@deepseek-ai/dsh-client-store`、
   `@deepseek-ai/dsh-client-ui-primitives` 留给宿主共享模块表，
   其余（katex、micromark 全家桶等）全部内联进 bundle。

`npm run verify` 会校验：host 侧导出 `name/inject/apply`、client 只 require 平台模块、
factory 能真正执行、8 个 CSS Module 都已注入。

## 三、接入本机 DSH（link 方式，改完即生效）

```sh
npm run build
dsh plugin --profile web add link:/Users/ymj/Desktop/code/dsh-better-display
```

之后每次改完源码，只需：

```sh
npm run build        # 重新产出 lib/
```

然后**重启 `dsh web` 进程**并刷新页面（`dsh.bundle` 在开机时捕获，运行中的 Host 不会热挂载新 bundle）。

卸载：

```sh
dsh plugin --profile web remove dsh-better-display
```

> 不要手动往 profile 的 `cordis.patch.yml` 里再写一条 `dsh-better-display` insert，
> 会和 `dsh.bundle` 重复挂载。

## 四、目录结构

```text
build.mjs             自建构建脚本（esbuild + lightningcss）
verify.mjs            产物冒烟校验
src/dsh-better-display.ts   Host 侧入口（webServer 路由、技能状态探测）
src/client/           浏览器侧（Reader / ReasoningCard / 折叠 / Markdown / 设置面板）
src/client/*.module.css    CSS Module，构建时编译成注入式样式
tests/                纯逻辑单测（node:test + tsx）
lib/                  构建产物，随仓库提交，便于直接安装
```

## 五、常用命令

```sh
npm run typecheck    # tsc --noEmit
npm run test         # node --import tsx/esm --test tests/*.test.ts
npm run check        # typecheck + test + build + verify
npm run build:watch  # 监听源码增量构建
```

## 六、兼容性

- DeepSeek Harness `0.2.x`（`@deepseek-ai/dsh-*` peer 范围 `>=0.2.0-rc.1 <0.2.1`）
- Node.js `^22.19.0 || >=24`
- 只改展示层，不触碰 Agent 执行、SDK 与模型凭据

## 七、计划

- [ ] 思考卡片接「翻译模型」：设置面板选定固定模型，把英文 reasoning 异步译为中文展示，保留原文切换
- [ ] 折叠动效继续对齐官方 ChatView 的滚动行为

## 八、许可

展示与 Markdown 部分来自 DeepSeek Harness（MIT），动效参考 [Transitions.dev](https://transitions.dev/)。
本仓库代码遵循 [MIT](LICENSE)。上游版权见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
