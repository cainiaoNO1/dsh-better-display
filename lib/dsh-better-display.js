// src/dsh-better-display.ts
import { spawn } from "node:child_process";

// src/skill-roots.ts
import { access, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// src/skill-status.ts
var GENERATIVE_MCPAPPS_SKILL = "generative-mcpapps";
var CONVENTIONAL_SKILL_ROOTS = [".dsh/skills", ".agents/skills"];
var SKILL_PACK_RELATIVE = `skills/${GENERATIVE_MCPAPPS_SKILL}`;
function skillNameMatches(name2) {
  return typeof name2 === "string" && name2 === GENERATIVE_MCPAPPS_SKILL;
}
function skillListIncludes(entries) {
  return Array.isArray(entries) && entries.some((entry) => skillNameMatches(entry?.name));
}
function skillRootEntryMatches(entryName) {
  return entryName === GENERATIVE_MCPAPPS_SKILL || entryName === `${GENERATIVE_MCPAPPS_SKILL}.md`;
}
function skillsFromListResult(result) {
  if (Array.isArray(result)) return result;
  if (result === null || typeof result !== "object") return [];
  const record = result;
  if (record.ok === false) return [];
  if (Array.isArray(record.skills)) return record.skills;
  if (record.value && typeof record.value === "object") {
    const value = record.value;
    if (Array.isArray(value.skills)) return value.skills;
    if (Array.isArray(record.value)) return record.value;
  }
  return [];
}
function publicSkillRoots() {
  return CONVENTIONAL_SKILL_ROOTS.map((path) => ({ source: "conventional", path }));
}
function toPublicSkillStatus(status) {
  return {
    name: status.name,
    installed: status.installed,
    via: status.via,
    roots: publicSkillRoots()
  };
}

// src/skill-roots.ts
function expandHomePath(path, home = homedir()) {
  if (path === "~") return home;
  if (path.startsWith("~/") || path.startsWith("~\\")) return join(home, path.slice(2));
  return path;
}
function resolveDshHome(env = process.env, home = homedir()) {
  const fromEnv = env.DSH_HOME;
  const selected = fromEnv !== void 0 && fromEnv.trim().length > 0 ? fromEnv : join(home, ".dsh");
  return resolve(expandHomePath(selected, home));
}
function resolveAgentsHome(env = process.env, home = homedir()) {
  const fromEnv = env.DSH_AGENTS_HOME;
  const selected = fromEnv !== void 0 && fromEnv.trim().length > 0 ? fromEnv : join(home, ".agents");
  return resolve(expandHomePath(selected, home));
}
function userSkillRoots(env = process.env, home = homedir()) {
  return [
    { source: "user-dsh", path: join(resolveDshHome(env, home), "skills") },
    { source: "user-agents", path: join(resolveAgentsHome(env, home), "skills") }
  ];
}
function projectSkillRoots(projectRoot) {
  return [
    { source: "project-dsh", path: join(projectRoot, ".dsh", "skills") },
    { source: "project-agents", path: join(projectRoot, ".agents", "skills") }
  ];
}
async function findProjectRoot(cwd) {
  let current = resolve(cwd);
  while (true) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(cwd);
    current = parent;
  }
}
async function rootHasGenerativeMcpapps(rootPath) {
  let entries;
  try {
    entries = await readdir(rootPath, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.name === ".system") continue;
    if (!skillRootEntryMatches(entry.name)) continue;
    if (entry.isDirectory()) {
      try {
        await access(join(rootPath, entry.name, "SKILL.md"));
        return true;
      } catch {
        continue;
      }
    }
    if (entry.isFile()) return true;
  }
  return false;
}
function pluginSkillPackPath(moduleUrl = import.meta.url) {
  const here = dirname(fileURLToPath(moduleUrl));
  const candidates = [
    join(here, "../skills", GENERATIVE_MCPAPPS_SKILL),
    join(here, "../../skills", GENERATIVE_MCPAPPS_SKILL),
    join(here, "skills", GENERATIVE_MCPAPPS_SKILL)
  ];
  return candidates.find((path) => existsSync(join(path, "SKILL.md")));
}
async function scanGenerativeMcpappsStatus(options = {}) {
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const roots = [...userSkillRoots(env, home)];
  const cwd = typeof options.cwd === "string" && options.cwd.trim().length > 0 ? isAbsolute(options.cwd) ? options.cwd : resolve(options.cwd) : void 0;
  if (cwd !== void 0) roots.unshift(...projectSkillRoots(await findProjectRoot(cwd)));
  const inspected = [];
  let rootHit = false;
  for (const root of roots) {
    const present = await rootHasGenerativeMcpapps(root.path);
    inspected.push({ ...root, present });
    if (present) rootHit = true;
  }
  let via = null;
  let listHit = false;
  if (options.listSkills) {
    try {
      listHit = skillListIncludes(await options.listSkills());
      if (listHit) via = "skills.list";
    } catch {
    }
  }
  if (!listHit && rootHit) via = "skill-root";
  const packPath = options.packPath ?? pluginSkillPackPath();
  return {
    name: GENERATIVE_MCPAPPS_SKILL,
    installed: listHit || rootHit,
    via,
    roots: inspected,
    ...packPath !== void 0 ? { packPath } : {}
  };
}

// src/translate.ts
var TRANSLATION_MAX_INPUT_CHARS = 12e3;
var TRANSLATION_HARD_MAX_CHARS = 1e5;
var TRANSLATION_MAX_OUTPUT_TOKENS = 8192;
var TRANSLATION_TIMEOUT_MS = 9e4;
var SYSTEM_PROMPT = [
  "\u4F60\u662F\u4E00\u4E2A\u7FFB\u8BD1\u5668\uFF0C\u628A\u6A21\u578B\u7684\u4E2D\u6587/\u82F1\u6587\u601D\u8003\u8FC7\u7A0B\u7FFB\u8BD1\u6210\u7B80\u4F53\u4E2D\u6587\u3002",
  "",
  "\u89C4\u5219\uFF1A",
  '1. \u53EA\u8F93\u51FA\u8BD1\u6587\uFF0C\u4E0D\u8981\u4EFB\u4F55\u524D\u8A00\u3001\u8BF4\u660E\u3001\u6807\u9898\u6216"\u4EE5\u4E0B\u662F\u7FFB\u8BD1"\u4E4B\u7C7B\u7684\u8BDD\u3002',
  "2. \u4EE3\u7801\u3001\u547D\u4EE4\u3001\u6587\u4EF6\u8DEF\u5F84\u3001\u53D8\u91CF\u540D\u3001\u51FD\u6570\u540D\u3001API \u540D\u3001\u4E13\u6709\u6280\u672F\u540D\u8BCD\u4FDD\u6301\u82F1\u6587\u539F\u6837\uFF0C\u4E0D\u8981\u7FFB\u8BD1\u3002",
  "3. \u4FDD\u7559\u539F\u6587\u7684\u6BB5\u843D\u7ED3\u6784\u3001\u6362\u884C\u548C\u5217\u8868\u7B26\u53F7\u3002",
  "4. \u539F\u6587\u91CC\u5DF2\u6709\u7684\u4E2D\u6587\u539F\u6837\u4FDD\u7559\u3002",
  "5. \u4E0D\u8981\u603B\u7ED3\u3001\u4E0D\u8981\u6269\u5199\u3001\u4E0D\u8981\u89E3\u91CA\uFF0C\u9010\u53E5\u5BF9\u5E94\u7FFB\u8BD1\u3002"
].join("\n");
var TRANSLATION_MAX_PROMPT_CHARS = 2e3;
function buildSystemPrompt(extra) {
  const trimmed = typeof extra === "string" ? extra.trim() : "";
  if (!trimmed) return SYSTEM_PROMPT;
  const clipped = trimmed.length > TRANSLATION_MAX_PROMPT_CHARS ? trimmed.slice(0, TRANSLATION_MAX_PROMPT_CHARS) : trimmed;
  return `${SYSTEM_PROMPT}

\u7528\u6237\u9644\u52A0\u8981\u6C42\uFF08\u4F18\u5148\u9075\u5B88\uFF09\uFF1A
${clipped}`;
}
function readTranslationRequest(body) {
  const data = body && typeof body === "object" ? body : {};
  const text = typeof data.text === "string" ? data.text : "";
  if (!text.trim()) return { error: "\u601D\u8003\u5185\u5BB9\u4E3A\u7A7A" };
  const provider = typeof data.provider === "string" ? data.provider.trim() : "";
  const model = typeof data.model === "string" ? data.model.trim() : "";
  if (!provider || !model) return { error: "\u672A\u9009\u62E9\u7FFB\u8BD1\u6A21\u578B" };
  const prompt = typeof data.prompt === "string" ? data.prompt : "";
  const requestedMax = typeof data.maxChars === "number" && Number.isFinite(data.maxChars) && data.maxChars > 0 ? Math.min(Math.floor(data.maxChars), TRANSLATION_HARD_MAX_CHARS) : TRANSLATION_MAX_INPUT_CHARS;
  return {
    text: text.length > requestedMax ? text.slice(0, requestedMax) : text,
    route: { provider, model },
    prompt: prompt.length > TRANSLATION_MAX_PROMPT_CHARS ? prompt.slice(0, TRANSLATION_MAX_PROMPT_CHARS) : prompt,
    maxChars: requestedMax
  };
}
async function collectText(stream, signal) {
  let text = "";
  let finish = "stop";
  let failure;
  for await (const chunk of stream) {
    signal.throwIfAborted();
    if (chunk.type === "text-delta") text += chunk.text;
    else if (chunk.type === "finish") {
      const reason = chunk.reason;
      finish = reason?.kind ?? "stop";
      const message = reason?.failure?.message;
      if (message) failure = reason?.failure?.status ? `${message}\uFF08HTTP ${reason.failure.status}\uFF09` : message;
    }
  }
  return { text: text.trim(), finish, failure };
}
async function translateReasoning(llm, input, outer) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error("\u7FFB\u8BD1\u8D85\u65F6"));
  }, TRANSLATION_TIMEOUT_MS);
  const onAbort = () => {
    controller.abort(outer?.reason);
  };
  outer?.addEventListener("abort", onAbort, { once: true });
  try {
    const maxTokens = Math.min(
      TRANSLATION_MAX_OUTPUT_TOKENS,
      Math.max(4096, Math.ceil(input.text.length / 2))
    );
    const call = await llm.prepareCall(
      { ...input.route, maxTokens },
      controller.signal
    );
    const messages = [{ role: "user", content: [{ type: "text", text: input.text }] }];
    const stream = call.stream({
      ...call.config,
      messages,
      system: buildSystemPrompt(input.prompt),
      maxTokens,
      signal: controller.signal
    });
    const { text, finish, failure } = await collectText(stream, controller.signal);
    if (finish === "error" || finish === "aborted") {
      throw new Error(failure ? `\u7FFB\u8BD1\u672A\u5B8C\u6210\uFF1A${failure}` : `\u7FFB\u8BD1\u672A\u5B8C\u6210\uFF08${finish}\uFF09`);
    }
    if (!text) throw new Error("\u6A21\u578B\u6CA1\u6709\u8FD4\u56DE\u8BD1\u6587");
    return text;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onAbort);
  }
}
async function listTranslationModels(llm) {
  const providers = typeof llm.listProviders === "function" ? llm.listProviders() : [];
  return Promise.all(providers.map(async (provider) => {
    let models = [];
    if (typeof llm.listModels === "function") {
      try {
        const listed = await llm.listModels(provider.id);
        models = listed.map((model) => ({ id: model.id, name: model.name }));
      } catch {
      }
    }
    return { id: provider.id, name: provider.name, models };
  }));
}

// src/persistent-config.ts
import { existsSync as existsSync2, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { join as join2 } from "node:path";
var CONFIG_DIR = join2(homedir2(), ".dsh", "dsh-better-display");
var CONFIG_FILE = join2(CONFIG_DIR, "config.json");
function loadPersistentConfig(customFile = CONFIG_FILE) {
  try {
    if (!existsSync2(customFile)) return {};
    const raw = readFileSync(customFile, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
function savePersistentConfig(patch, customFile = CONFIG_FILE) {
  try {
    const dir = customFile.slice(0, customFile.lastIndexOf("/"));
    if (dir) mkdirSync(dir, { recursive: true });
    const current = loadPersistentConfig(customFile);
    const next = { ...current, ...patch };
    writeFileSync(customFile, JSON.stringify(next, null, 2), "utf8");
    return next;
  } catch (err) {
    console.error("Failed to save dsh-better-display persistent config:", err);
    return loadPersistentConfig(customFile);
  }
}

// src/dsh-better-display.ts
var name = "dsh-better-display";
var inject = ["webServer"];
function writeJson(res, status, body) {
  res.setHeader("Content-Type", "application/json");
  res.statusCode = status;
  res.end(JSON.stringify(body));
}
function skillLister(ctx) {
  const skills = ctx.get?.("skills");
  if (typeof skills?.list !== "function") return void 0;
  return async () => skillsFromListResult(await skills.list({}));
}
async function readJsonBody(req, limit = 1 << 20) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > limit) throw new Error("\u8BF7\u6C42\u4F53\u8FC7\u5927");
    chunks.push(buf);
  }
  if (size === 0) return void 0;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function apply(ctx) {
  console.log("[my-plugins/dsh-better-display] loaded");
  const llm = () => ctx.get?.("llm");
  if (ctx.webServer) {
    ctx.effect(() => {
      const disposeReveal = ctx.webServer.register({
        kind: "exact",
        path: "/better-display/reveal",
        handler: async (req, res) => {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end();
            return;
          }
          let body = "";
          req.on("data", (chunk) => {
            body += chunk;
          });
          req.on("end", () => {
            try {
              const data = JSON.parse(body);
              const targetPath = typeof data.path === "string" ? data.path.trim() : "";
              if (!targetPath) {
                res.statusCode = 400;
                res.end(JSON.stringify({ ok: false, error: "Empty path" }));
                return;
              }
              if (process.platform === "darwin") {
                spawn("open", ["-R", targetPath], { detached: true, stdio: "ignore" });
              } else if (process.platform === "win32") {
                spawn("explorer.exe", [`/select,${targetPath}`], { detached: true, stdio: "ignore" });
              } else {
                spawn("xdg-open", [targetPath], { detached: true, stdio: "ignore" });
              }
              res.setHeader("Content-Type", "application/json");
              res.statusCode = 200;
              res.end(JSON.stringify({ ok: true }));
            } catch (err) {
              res.statusCode = 400;
              res.end(JSON.stringify({ ok: false, error: String(err) }));
            }
          });
        }
      });
      const disposeSkill = ctx.webServer.register({
        kind: "exact",
        path: "/better-display/skill-status",
        handler: async (req, res) => {
          if (req.method !== "GET") {
            res.statusCode = 405;
            res.end();
            return;
          }
          try {
            const url = new URL(req.url ?? "", "http://127.0.0.1");
            const cwd = url.searchParams.get("cwd") ?? void 0;
            const status = await scanGenerativeMcpappsStatus({
              cwd,
              listSkills: skillLister(ctx)
            });
            writeJson(res, 200, toPublicSkillStatus(status));
          } catch (err) {
            writeJson(res, 500, { ok: false, error: String(err) });
          }
        }
      });
      const disposeTranslate = ctx.webServer.register({
        kind: "exact",
        path: "/better-display/translate-reasoning",
        handler: async (req, res) => {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end();
            return;
          }
          const service = llm();
          if (!service?.prepareCall) {
            writeJson(res, 503, { ok: false, error: "\u5F53\u524D\u5BBF\u4E3B\u6CA1\u6709\u53EF\u7528\u7684 LLM \u670D\u52A1" });
            return;
          }
          let input;
          try {
            input = readTranslationRequest(await readJsonBody(req));
          } catch (err) {
            writeJson(res, 400, { ok: false, error: String(err) });
            return;
          }
          if ("error" in input) {
            writeJson(res, 400, { ok: false, error: input.error });
            return;
          }
          const abort = new AbortController();
          const onClose = () => {
            abort.abort(new Error("\u5BA2\u6237\u7AEF\u5DF2\u65AD\u5F00"));
          };
          res.on("close", onClose);
          try {
            const text = await translateReasoning(service, input, abort.signal);
            if (!res.writableEnded) writeJson(res, 200, { ok: true, text });
          } catch (err) {
            if (!res.writableEnded) writeJson(res, 502, { ok: false, error: String(err instanceof Error ? err.message : err) });
          } finally {
            res.off("close", onClose);
          }
        }
      });
      const disposeModels = ctx.webServer.register({
        kind: "exact",
        path: "/better-display/translation-models",
        handler: async (req, res) => {
          if (req.method !== "GET") {
            res.statusCode = 405;
            res.end();
            return;
          }
          const service = llm();
          if (!service?.prepareCall) {
            writeJson(res, 200, { ok: true, providers: [] });
            return;
          }
          try {
            writeJson(res, 200, { ok: true, providers: await listTranslationModels(service) });
          } catch (err) {
            writeJson(res, 500, { ok: false, error: String(err) });
          }
        }
      });
      const disposeConfig = ctx.webServer.register({
        kind: "exact",
        path: "/better-display/config",
        handler: async (req, res) => {
          if (req.method === "GET") {
            writeJson(res, 200, { ok: true, config: loadPersistentConfig() });
            return;
          }
          if (req.method === "POST") {
            try {
              const body = await readJsonBody(req);
              const saved = savePersistentConfig(body);
              writeJson(res, 200, { ok: true, config: saved });
            } catch (err) {
              writeJson(res, 400, { ok: false, error: String(err) });
            }
            return;
          }
          res.statusCode = 405;
          res.end();
        }
      });
      return () => {
        disposeReveal();
        disposeSkill();
        disposeTranslate();
        disposeModels();
        disposeConfig();
      };
    }, "dsh-better-display: reveal, skill-status and translation routes");
  }
}
export {
  apply,
  inject,
  name
};
