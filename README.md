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
| **思考翻译** | 设置面板选定固定模型，英文 reasoning 异步译为中文显示，每张卡片可一键切回原文；默认关闭 |
| **右上角开关组** | 自动折叠 / 自动展开 / 自动翻译 / 自动跟随，与「阅读 / 对话 / 轨迹」同一行靠右，全局生效并持久化 |
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

## 七、思考翻译

设置 → 本插件 → **把思考翻译成中文** 打开后，在下方选定一个固定模型（provider + model 列表来自宿主
`ctx.llm`）。

### 只在「你正看着它在思考」时翻译

翻译**不会**扫历史。触发条件是同时满足：

1. 你切到了这个会话（阅读视图只渲染当前激活会话，`conversation.view` 是 `only: viewId`）；
2. 这段思考**此刻仍在输出**（节点 `status === 'running'` 且它是最后一个 reasoning 段）。

子代理同理：只有你切到那个子代理的会话、且它正在打思考，才会翻。历史记录里的英文思考保持原样，
不产生任何调用——切会话不再是一次性账单。

节奏是「首次立即翻 + 每 1.6 秒节流跟进 + 收尾补一次」，所以边写边看就有中文可读；
输出结束后保留最后一次译文，不会闪回英文。

### 卡片状态

| 状态 | 按钮文案 | 卡片正文 |
| --- | --- | --- |
| 翻译中 | `正在翻译…` | 原文（不闪烁） |
| 已翻译 | `译文` | 中文译文 |
| 原文较长 | `译文（仅前半段）` | 截取设定上限字数的译文（默认 12000 字符，可设置） |
| 失败 | `翻译失败：<原因>` | 原文 |

点按钮随时在原文与译文之间切换（`aria-pressed` 反映当前是否在看原文）。中文占主导的思考、
短于 12 字的片段不会触发翻译，纯代码块也不会——既省钱也避免把通顺的中文重写一遍。

### 单次翻译字数上限设置

设置面板提供「单次翻译字数上限」配置，支持输入自定义数值与快捷预设按键（`6000` / `12000 (默认)` / `25000` / `50000` 字符）：
- 思考字数在上限内时全量翻译，卡片显示 `译文`；
- 超出上限时自动截取前半段翻译，卡片标记 `译文（仅前半段）`，避免过度消耗 Token 或超时；
- 点击「译文」随时切回 100% 完整原文；
- 上限写进根 store，所有会话生效并持久化。

### 附加提示词

模型选择框下方有一个「附加提示词」输入框，内容会**拼接到每次翻译的系统提示词末尾**
（标为「用户附加要求（优先遵守）」，因为模型对末尾指令遵从度更高）。留空则完全不影响默认行为。
上限 2000 字；提示词参与译文缓存键，改提示词不会误命中旧译文。

例如填「除了代码和文件路径，其余英文术语也译成中文」，`children` 就会从 `children`
变成「子元素」，而不是默认规则下的保留英文。

### 实现

翻译**只在宿主侧发起**：浏览器 POST `/better-display/translate-reasoning`，
宿主用 `ctx.llm.prepareCall` + `stream` 走一次纯文本补全，90 秒超时，客户端断开即中止。
译文按 `provider + model + 提示词散列 + 文本散列` 缓存在浏览器内存（上限 240 条），
同一段思考不会重复付费。宿主没有 LLM 服务时该接口返回 503，插件其余功能不受影响。

## 八、计划

- [x] 思考卡片接「翻译模型」：设置面板选定固定模型，把英文 reasoning 异步译为中文展示，保留原文切换
- [x] 翻译只在会话激活且思考正在输出时触发；子代理同理
- [x] 设置面板支持附加提示词，注入每次翻译调用
- [ ] 折叠动效继续对齐官方 ChatView 的滚动行为

## 九、许可

展示与 Markdown 部分来自 DeepSeek Harness（MIT），动效参考 [Transitions.dev](https://transitions.dev/)。
本仓库代码遵循 [MIT](LICENSE)。上游版权见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
