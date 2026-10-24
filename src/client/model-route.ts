export interface ModelRoute {
  id: string;
  name: string;
  models: { id: string; name: string }[];
}

export function findDefaultModel(routes: ModelRoute[]): { provider: string; model: string } | undefined {
  for (const r of routes) {
    if (/deepseek/i.test(r.id) || /deepseek/i.test(r.name)) {
      const flash = r.models.find(m => /flash/i.test(m.id) || /flash/i.test(m.name));
      if (flash) return { provider: r.id, model: flash.id };
      if (r.models.length > 0) return { provider: r.id, model: r.models[0].id };
    }
  }
  for (const r of routes) {
    if (r.models.length > 0) return { provider: r.id, model: r.models[0].id };
  }
  return undefined;
}
