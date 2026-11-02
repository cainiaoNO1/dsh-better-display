# AGENTS.md

# dsh-better-display 协作与自动化规范

> 本项目为两台主力设备（Mac 开发机 + Acer 运行机）协同维护项目，所有智能体与开发者必须严格遵守本规范。

---

## 核心规则：修改代码后自动提交、推送与 Acer 同步（强制执行）

任何智能体在 Mac 端完成代码修改与自测后，**必须作为当前操作的收尾闭环，依次执行以下流水线**，不得遗漏或等待用户额外指示：

### 1. 提交与构建
- 若修改了源码，需先执行构建指令：`npm run build`
- 执行本地提交：
  ```bash
  git add -A && git commit -m "<提交说明>"
  ```

### 2. 推送远程仓库 (GitHub)
- 立即推送到远程 `main` 分支：
  ```bash
  git push origin main
  ```

### 3. 自动同步到 Acer 电脑
- 通过 SSH（或 MCP `ssh-windows-acer`）连接 Acer 电脑并拉取最新代码：
  ```bash
  sshpass -p 'ymj991107' ssh -o StrictHostKeyChecking=no yuanmingjie@100.96.35.26 "cd /d F:\code\dsh-better-display && git pull origin main"
  ```

---

## 设备与路径参考表

| 设备 | 角色 | 路径 / 访问方式 |
| :--- | :--- | :--- |
| **Mac 电脑** | 源码开发机 | `/Users/ymj/Desktop/code/dsh-better-display` |
| **Acer 电脑** | 远程运行机 | `F:\code\dsh-better-display` (SSH: `yuanmingjie@100.96.35.26:22`) |
| **GitHub** | 远端代码中枢 | `https://github.com/cainiaoNO1/dsh-better-display` |

---

## 插件运行与依赖注意
- 项目定位：DSH 阅读视图插件（过程折叠、思考卡片、聚焦模式）
- 若涉及 DSH 运行环境更新，务必在更新前备份原有插件与配置。
