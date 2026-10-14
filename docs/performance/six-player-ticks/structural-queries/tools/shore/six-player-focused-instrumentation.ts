/** Diagnostic-only scopes inserted into an ephemeral bundle, never production files. */
import ts from "typescript";

export const FOCUS_HOOK = "__sketchSixPlayerFocus";
type Scope = { name: string; owner: string | undefined; scriptId: string | undefined; shipId: string | undefined;
  started: number; childMs: number; parent: Scope | undefined };
export type FocusedScopeSample = {
  name: string; owner?: string; scriptId?: string; shipId?: string;
  calls: number; inclusiveMs: number; exclusiveMs: number; maxMs: number;
};
export type FocusedTickSample = { tick: number; startedMs: number; endedMs: number; scopes: FocusedScopeSample[] };
export type ShoreInput = {
  tick: number; sequence: number; owner: string; snapshot: unknown; water: { x: number; y: number };
  despiteGuns: boolean; teams?: Partial<Record<string, string>>; scriptId?: string;
};

export class FocusedScopes {
  private tick: number | undefined;
  private started = 0;
  private active: Scope | undefined;
  private totals = new Map<string, FocusedScopeSample>();
  private shoreInputs: ShoreInput[] = [];
  private shoreSequence = 0;
  readonly ticks: FocusedTickSample[] = [];
  constructor(private readonly selected: ReadonlySet<number>) {}
  includes(tick: number) { return this.selected.has(tick); }
  begin(tick: number) {
    if (this.active) throw new Error("Unclosed focused scope before tick");
    this.tick = this.selected.has(tick) ? tick : undefined;
    if (this.tick !== undefined) { this.started = performance.now(); this.totals.clear(); }
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
  captureShoreInput(snapshot: unknown, owner: string, water: { x: number; y: number },
    teams: Partial<Record<string, string>> | undefined, despiteGuns: boolean) {
    if (this.tick === undefined) return;
    // Hold the actual immutable world frame until the outer tick ends. Do not copy or serialize the world in its hot path.
    // Real runtime team maps are plain records; retain own values now, independently of later planner contexts.
    this.shoreInputs.push({ tick: this.tick, sequence: this.shoreSequence++, owner, snapshot,
      water: { x: water.x, y: water.y }, despiteGuns,
      ...(teams === undefined ? {} : { teams: { ...teams } }),
      ...(this.active?.scriptId === undefined ? {} : { scriptId: this.active.scriptId }) });
  }
  takeShoreInputs(): ShoreInput[] {
    const result = this.shoreInputs;
    this.shoreInputs = [];
    return result;
  }
  end() {
    if (this.active) throw new Error("Unclosed focused scope after tick");
    if (this.tick !== undefined) this.ticks.push({ tick: this.tick, startedMs: this.started, endedMs: performance.now(), scopes: [...this.totals.values()] });
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
                  : file.endsWith("/src/ai/policy/naval.ts") ? { navalBudgetReserve: { owner: "owner" }, shoreSpot: { owner: "owner" } }
                    : file.endsWith("/src/ai/policy/v9/shop.ts") ? { shopErrandCost: { owner: "owner" } }
                      : file.endsWith("/src/shared/terrain.ts") ? { tilesOf: {} } : {};
  const edits: { at: number; text: string }[] = [];
  const hooks: string[] = [];
  for (const node of ast.statements) {
    if (!ts.isFunctionDeclaration(node) || !node.name || !node.body || !(node.name.text in names)) continue;
    const details = names[node.name.text]!;
    if (node.asteriskToken || node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)) throw new Error(`Cannot focus async/generator ${node.name.text}`);
    const enter = `globalThis.${FOCUS_HOOK}.enter(${JSON.stringify(node.name.text)},${details.owner ?? "undefined"},undefined,${details.ship ?? "undefined"})`;
    const capture = node.name.text === "shoreSpot"
      ? `if(__sixFocusMark)globalThis.${FOCUS_HOOK}.captureShoreInput(snapshot,owner,water,options.teams,despiteGuns);\n` : "";
    edits.push({ at: node.body.getStart(ast) + 1, text: `\nconst __sixFocusMark = ${enter};\ntry {\n${capture}` });
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
  const missing = Object.keys(names).filter(name => !hooks.includes(name));
  if (missing.length) throw new Error(`Focused boundary changed in ${file}: ${missing}`);
  for (const edit of edits.sort((a, b) => b.at - a.at)) text = text.slice(0, edit.at) + edit.text + text.slice(edit.at);
  return { contents: text, hooks };
}
