/** Diagnostic-only scopes inserted into an ephemeral bundle, never production files. */
import ts from "typescript";

export const FOCUS_HOOK = "__sketchSixPlayerFocus";
type Scope = { name: string; owner: string | undefined; scriptId: string | undefined; shipId: string | undefined;
  started: number; childMs: number; parent: Scope | undefined };
export type FocusedScopeSample = {
  name: string; owner?: string; scriptId?: string; shipId?: string;
  calls: number; inclusiveMs: number; exclusiveMs: number; maxMs: number;
};
type TerrainCacheState = { fields: ReadonlyMap<number, unknown>; clock: number };
export type TerrainCacheCounter = { event: string; runtimeId: number; mover: string; key: number;
  owner?: string; scriptId?: string; queryContext?: string; calls: number; firstSequence: number; lastSequence: number;
  firstClock: number; lastClock: number; minSize: number; maxSize: number };
export type TerrainCacheEvent = { sequence: number; event: string; runtimeId: number; mover: string;
  key: number; clock: number; size: number; owner?: string; scriptId?: string; queryContext?: string };
export type FocusedTickSample = { tick: number; startedMs: number; endedMs: number; scopes: FocusedScopeSample[];
  terrainCache?: TerrainCacheCounter[]; terrainEvents?: TerrainCacheEvent[] };

export class FocusedScopes {
  private tick: number | undefined;
  private started = 0;
  private active: Scope | undefined;
  private totals = new Map<string, FocusedScopeSample>();
  private terrainRuntimeIds = new WeakMap<object, { id: number; mover: string }>();
  private nextTerrainRuntimeId = 1;
  private terrainCounters = new Map<string, TerrainCacheCounter>();
  private terrainEvents: TerrainCacheEvent[] = [];
  private eventSequence = 0;
  private queryContext: string | undefined;
  readonly ticks: FocusedTickSample[] = [];
  constructor(private readonly selected: ReadonlySet<number>) {}
  includes(tick: number) { return this.selected.has(tick); }
  begin(tick: number) {
    if (this.active) throw new Error("Unclosed focused scope before tick");
    this.tick = this.selected.has(tick) ? tick : undefined;
    if (this.tick !== undefined) { this.started = performance.now(); this.totals.clear(); this.terrainCounters.clear(); this.terrainEvents = []; this.eventSequence = 0; }
  }
  enter(name: string, owner?: string, scriptId?: string, shipId?: string): Scope | undefined {
    if (this.tick === undefined) return undefined;
    const mark: Scope = { name, owner: owner ?? this.active?.owner, scriptId: scriptId ?? this.active?.scriptId,
      shipId: shipId ?? this.active?.shipId, started: performance.now(), childMs: 0, parent: this.active };
    this.active = mark;
    return mark;
  }
  leave(mark: Scope | undefined) {
    if (!mark) return;
    if (this.active !== mark) throw new Error("Focused scopes closed out of order");
    const ms = performance.now() - mark.started;
    this.active = mark.parent;
    if (mark.parent) mark.parent.childMs += ms;
    const key = JSON.stringify([mark.name, mark.owner, mark.scriptId, mark.shipId]);
    let total = this.totals.get(key);
    if (!total) {
      total = { name: mark.name, ...(mark.owner === undefined ? {} : { owner: mark.owner }),
        ...(mark.scriptId === undefined ? {} : { scriptId: mark.scriptId }),
        ...(mark.shipId === undefined ? {} : { shipId: mark.shipId }), calls: 0, inclusiveMs: 0, exclusiveMs: 0, maxMs: 0 };
      this.totals.set(key, total);
    }
    total.calls += 1; total.inclusiveMs += ms; total.exclusiveMs += ms - mark.childMs; total.maxMs = Math.max(total.maxMs, ms);
  }
  call<T>(name: string, owner: string, scriptId: string, body: () => T): T {
    const mark = this.enter(name, owner, scriptId);
    try { return body(); } finally { this.leave(mark); }
  }
  /** Sidecar identity only: the actual terrain runtime/cache is never mutated. */
  registerTerrain(state: object, mover: string) {
    if (!this.terrainRuntimeIds.has(state)) this.terrainRuntimeIds.set(state, { id: this.nextTerrainRuntimeId++, mover });
  }
  enterTerrainContext(name: string): string | undefined {
    if (this.tick === undefined) return undefined;
    const previous = this.queryContext;
    this.queryContext = previous === undefined ? name : `${previous}/${name}`;
    return previous;
  }
  leaveTerrainContext(previous: string | undefined) { if (this.tick !== undefined) this.queryContext = previous; }
  terrainCall<T>(name: string, body: () => T): T {
    const previous = this.enterTerrainContext(name);
    try { return body(); } finally { this.leaveTerrainContext(previous); }
  }
  /** No clock reads, field iteration, timing scope or field/cache writes. */
  terrainEvent(event: string, state: TerrainCacheState, key: number) {
    if (this.tick === undefined) return;
    const runtime = this.terrainRuntimeIds.get(state);
    const runtimeId = runtime?.id ?? 0, mover = runtime?.mover ?? "unregistered";
    const owner = this.active?.owner, scriptId = this.active?.scriptId, queryContext = this.queryContext;
    const sequence = ++this.eventSequence, clock = state.clock, size = state.fields.size;
    const aggregateKey = `${runtimeId}|${event}|${key}|${owner ?? ""}|${scriptId ?? ""}|${queryContext ?? ""}`;
    let counter = this.terrainCounters.get(aggregateKey);
    if (!counter) {
      counter = { event, runtimeId, mover, key, ...(owner === undefined ? {} : { owner }), ...(scriptId === undefined ? {} : { scriptId }),
        ...(queryContext === undefined ? {} : { queryContext }),
        calls: 0, firstSequence: sequence, lastSequence: sequence, firstClock: clock, lastClock: clock, minSize: size, maxSize: size };
      this.terrainCounters.set(aggregateKey, counter);
    }
    counter.calls += 1; counter.lastSequence = sequence; counter.lastClock = clock;
    counter.minSize = Math.min(counter.minSize, size); counter.maxSize = Math.max(counter.maxSize, size);
    // Hits/queries are aggregated; miss/build/eviction order proves churn
    // without allocating a trace object for every frequently repeated hit.
    if (event !== "exactField" && event !== "cachedHit") this.terrainEvents.push({ sequence, event, runtimeId, mover, key, clock, size,
      ...(owner === undefined ? {} : { owner }), ...(scriptId === undefined ? {} : { scriptId }), ...(queryContext === undefined ? {} : { queryContext }) });
  }
  end() {
    if (this.active) throw new Error("Unclosed focused scope after tick");
    if (this.queryContext !== undefined) throw new Error("Unclosed terrain query context after tick");
    if (this.tick !== undefined) this.ticks.push({ tick: this.tick, startedMs: this.started, endedMs: performance.now(), scopes: [...this.totals.values()],
      ...(this.terrainCounters.size ? { terrainCache: [...this.terrainCounters.values()], terrainEvents: this.terrainEvents } : {}) });
    this.tick = undefined;
  }
}

/** Returns edits on original source coordinates. Calls keep native receivers and argument evaluation. */
export function instrumentFocusedSource(file: string, text: string): { contents: string; hooks: string[] } {
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names: Record<string, { owner?: string; ship?: string }> = file.endsWith("/src/shared/sim.ts")
    ? { updateUnits: {}, separateUnits: {}, keepUnitsOutOfBuildings: {}, updateTraining: {}, syncBuildingBodies: {} }
    : file.endsWith("/src/shared/sailing.ts") ? { sailToward: { ship: "ship.id" } }
      : file.endsWith("/src/shared/ship-navigation.ts") ? { planShipRouteImpl: { ship: "ship.id" }, gridFor: { ship: "ship.id" } }
        : file.endsWith("/src/shared/ship-planning-job.ts") ? { prepareShipPlanningJobs: {}, prepareShipPlanningJob: { ship: "ship.id" } }
          : file.endsWith("/src/ai/policy/script-runner.ts") ? { unitClaims: { owner: "owner" } }
            : file.endsWith("/src/ai/planner-context.ts") ? { planAiOwnerCommandEntries: { owner: "request.playerId" } }
              : file.endsWith("/src/ai/bootstrap_1/policy.ts") ? { bootstrapPolicyContext: { owner: "owner" } }
                : file.endsWith("/src/ai/bootstrap_1/mounted-recruitment.ts") ? { mountedRecruitment: { owner: "owner" } }
                  : file.endsWith("/src/ai/policy/naval.ts") ? { navalBudgetReserve: { owner: "owner" } }
                    : file.endsWith("/src/ai/policy/v9/shop.ts") ? { shopErrandCost: { owner: "owner" } }
                      : file.endsWith("/src/shared/terrain.ts") ? { tilesOf: {} } : {};
  const edits: { at: number; text: string }[] = [];
  const hooks: string[] = [];
  const queryNames = file.endsWith("/src/ai/policy/naval-mines.ts") ? ["chooseNavalMine"]
    : file.endsWith("/src/ai/policy/naval.ts") ? ["shoreSpot"] : [];
  for (const node of ast.statements) {
    if (!ts.isFunctionDeclaration(node) || !node.name || !node.body || !queryNames.includes(node.name.text)) continue;
    edits.push({ at: node.body.getStart(ast) + 1,
      text: `\nconst __sixTerrainContext = globalThis.${FOCUS_HOOK}.enterTerrainContext(${JSON.stringify(node.name.text)});\ntry {\n` });
    edits.push({ at: node.body.end - 1, text: `\n} finally { globalThis.${FOCUS_HOOK}.leaveTerrainContext(__sixTerrainContext); }\n` });
    hooks.push(`terrain-context:${node.name.text}`);
  }
  if (queryNames.some(name => !hooks.includes(`terrain-context:${name}`))) throw new Error(`Terrain query context boundary changed in ${file}`);
  if (file.endsWith("/src/ai/policy/naval-mines.ts")) {
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
        && (node.expression.text.startsWith("nearestByRoute") || node.expression.text === "walkingDistance")) {
        const label = node.expression.text.startsWith("nearestByRoute") ? "nearestByRoute" : "road";
        edits.push({ at: node.getStart(ast), text: `globalThis.${FOCUS_HOOK}.terrainCall(${JSON.stringify(label)},()=>` });
        edits.push({ at: node.end, text: ")" });
        hooks.push(`terrain-context:chooseNavalMine.${label}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  for (const node of ast.statements) {
    if (!ts.isFunctionDeclaration(node) || !node.name || !node.body || !(node.name.text in names)) continue;
    const details = names[node.name.text]!;
    if (node.asteriskToken || node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)) throw new Error(`Cannot focus async/generator ${node.name.text}`);
    const enter = `globalThis.${FOCUS_HOOK}.enter(${JSON.stringify(node.name.text)},${details.owner ?? "undefined"},undefined,${details.ship ?? "undefined"})`;
    edits.push({ at: node.body.getStart(ast) + 1, text: `\nconst __sixFocusMark = ${enter};\ntry {\n` });
    edits.push({ at: node.body.end - 1, text: `\n} finally { globalThis.${FOCUS_HOOK}.leave(__sixFocusMark); }\n` });
    hooks.push(node.name.text);
  }
  if (file.endsWith("/src/ai/policy/script-runner.ts")) {
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && node.expression.expression.getText(ast) === "script"
        && ["run", "claimsUnits"].includes(node.expression.name.text)) {
        const name = `script.${node.expression.name.text}`;
        // An optional claims invocation returning undefined remains undefined;
        // the scope is an attempted claims boundary, not proof a callback exists.
        edits.push({ at: node.getStart(ast), text: `globalThis.${FOCUS_HOOK}.call(${JSON.stringify(name)},owner,script.id,()=>` });
        edits.push({ at: node.end, text: ")" });
        hooks.push(name);
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  if (file.endsWith("/src/shared/terrain.ts")) {
    const functions = new Map(ast.statements.filter(ts.isFunctionDeclaration).filter(node => node.name && node.body).map(node => [node.name!.text, node]));
    const bodyOf = (name: string) => {
      const body = functions.get(name)?.body;
      if (!body) throw new Error(`Terrain counter boundary missing ${name}`);
      return body;
    };
    const addEvent = (at: number, event: string, key: string) => edits.push({ at,
      text: `\nglobalThis.${FOCUS_HOOK}.terrainEvent(${JSON.stringify(event)},state,${key});\n` });
    const exact = bodyOf("exactField"); addEvent(exact.getStart(ast) + 1, "exactField", "target");
    const grown = bodyOf("grow"); addEvent(grown.getStart(ast) + 1, "grow", "sources[0] ?? -1");
    const created = bodyOf("createRuntime");
    const returned = created.statements.find(node => ts.isReturnStatement(node) && node.expression?.getText(ast) === "state");
    if (!returned) throw new Error("Terrain register boundary missing return state");
    edits.push({ at: returned.getStart(ast), text: `globalThis.${FOCUS_HOOK}.registerTerrain(state,mover);\n` });
    const cached = bodyOf("cached");
    const hit = cached.statements.find(node => ts.isIfStatement(node) && node.expression.getText(ast) === "known");
    if (!hit || !ts.isIfStatement(hit) || !ts.isBlock(hit.thenStatement)) throw new Error("Terrain cache known branch changed");
    addEvent(hit.thenStatement.getStart(ast) + 1, "cachedHit", "key");
    addEvent(hit.end, "cachedMiss", "key");
    let evictionCount = 0, storedCount = 0;
    const visitCached = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(ast) === "state.fields") {
        if (node.expression.name.text === "delete") { addEvent(node.parent.getStart(ast), "cachedEvict", node.arguments[0]!.getText(ast)); evictionCount += 1; }
        else if (node.expression.name.text === "set") { addEvent(node.parent.end, "cachedStored", "key"); storedCount += 1; }
      }
      ts.forEachChild(node, visitCached);
    };
    visitCached(cached);
    if (evictionCount !== 1 || storedCount !== 1) throw new Error("Terrain cache eviction/store boundaries changed");
    hooks.push("terrain-counter:exactField", "terrain-counter:cachedHit", "terrain-counter:cachedMiss", "terrain-counter:cachedEvict",
      "terrain-counter:cachedStored", "terrain-counter:grow", "terrain-runtime:mover-sidecar");
  }
  const missing = Object.keys(names).filter(name => !hooks.includes(name));
  if (missing.length) throw new Error(`Focused boundary changed in ${file}: ${missing}`);
  for (const edit of edits.sort((a, b) => b.at - a.at)) text = text.slice(0, edit.at) + edit.text + text.slice(edit.at);
  return { contents: text, hooks };
}
