import { spawn } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import { scanGenerativeMcpappsStatus } from './skill-roots.js';
import { skillsFromListResult, toPublicSkillStatus } from './skill-status.js';
import {
  listTranslationModels,
  readTranslationRequest,
  translateReasoning,
  type LlmFace,
} from './translate.js';
import {
  loadPersistentConfig,
  savePersistentConfig,
  type BetterDisplayPersistentConfig,
} from './persistent-config.js';

declare module '@deepseek-ai/cordis' {
  interface Context {
    webServer?: {
      register: (route: {
        kind: 'exact' | 'prefix';
        path: string;
        handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
      }) => () => void;
    };
  }
}

export const name = 'dsh-better-display';
/**
 * cordis 的 inject 只有「全要」语义（数组或映射），没有可选依赖一说，
 * 所以这里只声明真正必须的 webServer；`llm` 在请求发生时用 `ctx.get` 软取，
 * 宿主没装 LLM 服务时其余功能照常工作，只有翻译接口返回 503。
 */
export const inject = ['webServer'];

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

function skillLister(ctx: Context): (() => Promise<readonly { readonly name?: string }[] | undefined>) | undefined {
  const skills = ctx.get?.('skills') as { list?: (options?: object) => Promise<unknown> } | undefined;
  if (typeof skills?.list !== 'function') return undefined;
  return async () => skillsFromListResult(await skills.list!({}));
}

/** 读取并解析 JSON 请求体，超过上限直接拒绝。 */
async function readJsonBody(req: IncomingMessage, limit = 1 << 20): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > limit) throw new Error('请求体过大');
    chunks.push(buf);
  }
  if (size === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function apply(ctx: Context): void {
  console.log('[my-plugins/dsh-better-display] loaded');

  const llm = (): LlmFace | undefined => ctx.get?.('llm') as LlmFace | undefined;

  if (ctx.webServer) {
    ctx.effect(() => {
      const disposeReveal = ctx.webServer!.register({
        kind: 'exact',
        path: '/better-display/reveal',
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end();
            return;
          }
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            try {
              const data = JSON.parse(body);
              const targetPath = typeof data.path === 'string' ? data.path.trim() : '';
              if (!targetPath) {
                res.statusCode = 400;
                res.end(JSON.stringify({ ok: false, error: 'Empty path' }));
                return;
              }

              if (process.platform === 'darwin') {
                // Exact file reveal in macOS Finder with selection highlight
                spawn('open', ['-R', targetPath], { detached: true, stdio: 'ignore' });
              } else if (process.platform === 'win32') {
                // Exact file selection in Windows Explorer
                spawn('explorer.exe', [`/select,${targetPath}`], { detached: true, stdio: 'ignore' });
              } else {
                spawn('xdg-open', [targetPath], { detached: true, stdio: 'ignore' });
              }

              res.setHeader('Content-Type', 'application/json');
              res.statusCode = 200;
              res.end(JSON.stringify({ ok: true }));
            } catch (err) {
              res.statusCode = 400;
              res.end(JSON.stringify({ ok: false, error: String(err) }));
            }
          });
        },
      });
      const disposeSkill = ctx.webServer!.register({
        kind: 'exact',
        path: '/better-display/skill-status',
        handler: async (req, res) => {
          if (req.method !== 'GET') {
            res.statusCode = 405;
            res.end();
            return;
          }
          try {
            const url = new URL(req.url ?? '', 'http://127.0.0.1');
            const cwd = url.searchParams.get('cwd') ?? undefined;
            const status = await scanGenerativeMcpappsStatus({
              cwd,
              listSkills: skillLister(ctx),
            });
            writeJson(res, 200, toPublicSkillStatus(status));
          } catch (err) {
            writeJson(res, 500, { ok: false, error: String(err) });
          }
        },
      });
      // 思考翻译：浏览器侧没有 ctx.llm，必须由宿主代发一次性模型调用。
      const disposeTranslate = ctx.webServer!.register({
        kind: 'exact',
        path: '/better-display/translate-reasoning',
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end();
            return;
          }
          const service = llm();
          if (!service?.prepareCall) {
            writeJson(res, 503, { ok: false, error: '当前宿主没有可用的 LLM 服务' });
            return;
          }
          let input: ReturnType<typeof readTranslationRequest>;
          try {
            input = readTranslationRequest(await readJsonBody(req));
          } catch (err) {
            writeJson(res, 400, { ok: false, error: String(err) });
            return;
          }
          if ('error' in input) {
            writeJson(res, 400, { ok: false, error: input.error });
            return;
          }
          // 客户端关掉卡片时中断在途请求，别让模型白跑完再被丢弃。
          const abort = new AbortController();
          const onClose = () => { abort.abort(new Error('客户端已断开')); };
          res.on('close', onClose);
          try {
            const text = await translateReasoning(service, input, abort.signal);
            if (!res.writableEnded) writeJson(res, 200, { ok: true, text });
          } catch (err) {
            if (!res.writableEnded) writeJson(res, 502, { ok: false, error: String(err instanceof Error ? err.message : err) });
          } finally {
            res.off('close', onClose);
          }
        },
      });
      // 设置面板的模型下拉数据源。
      const disposeModels = ctx.webServer!.register({
        kind: 'exact',
        path: '/better-display/translation-models',
        handler: async (req, res) => {
          if (req.method !== 'GET') {
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
        },
      });
      // 宿主端持久化配置（重启 dsh web、换端口或清除本地缓存不丢配置）
      const disposeConfig = ctx.webServer!.register({
        kind: 'exact',
        path: '/better-display/config',
        handler: async (req, res) => {
          if (req.method === 'GET') {
            writeJson(res, 200, { ok: true, config: loadPersistentConfig() });
            return;
          }
          if (req.method === 'POST') {
            try {
              const body = await readJsonBody(req) as Partial<BetterDisplayPersistentConfig>;
              const saved = savePersistentConfig(body);
              writeJson(res, 200, { ok: true, config: saved });
            } catch (err) {
              writeJson(res, 400, { ok: false, error: String(err) });
            }
            return;
          }
          res.statusCode = 405;
          res.end();
        },
      });
      return () => {
        disposeReveal();
        disposeSkill();
        disposeTranslate();
        disposeModels();
        disposeConfig();
      };
    }, 'dsh-better-display: reveal, skill-status and translation routes');
  }
}
