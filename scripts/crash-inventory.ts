import fs from "node:fs";
import path from "node:path";
import * as ts from "typescript";

type FindingKind = "throw" | "nonNull";

type Finding = {
  file: string;
  line: number;
  column: number;
  kind: FindingKind;
  area: string;
  disposition: string;
  snippet: string;
};

const ROOT = process.cwd();
const SRC_ROOT = path.join(ROOT, "src");

function main() {
  const findings = productionFiles(SRC_ROOT).flatMap(scanFile).sort(compareFinding);
  const summary = summarize(findings);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ summary, findings }, null, 2));
    return;
  }
  console.log(markdown(summary, findings));
}

function productionFiles(root: string): string[] {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) return productionFiles(full);
    if (!entry.isFile() || !entry.name.endsWith(".ts")) return [];
    if (entry.name.endsWith(".test.ts") || entry.name === "vite-env.d.ts") return [];
    return [full];
  });
}

function scanFile(filePath: string): Finding[] {
  const sourceText = fs.readFileSync(filePath, "utf8");
  const source = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
  const findings: Finding[] = [];

  function add(kind: FindingKind, node: ts.Node) {
    const start = node.getStart(source);
    const position = source.getLineAndCharacterOfPosition(start);
    const file = relative(filePath);
    const snippet = sourceText.slice(start, node.getEnd()).split(/\r?\n/)[0]!.trim();
    findings.push({
      file,
      line: position.line + 1,
      column: position.character + 1,
      kind,
      area: areaFor(file),
      disposition: dispositionFor(file, kind, snippet),
      snippet,
    });
  }

  function visit(node: ts.Node) {
    if (ts.isThrowStatement(node)) add("throw", node);
    if (ts.isNonNullExpression(node)) add("nonNull", node);
    ts.forEachChild(node, visit);
  }

  visit(source);
  return findings;
}

function areaFor(file: string) {
  if (file.startsWith("src/shared/sim")) return "simulation";
  if (file.startsWith("src/shared/net")) return "network codec";
  if (file === "src/shared/replay.ts") return "debug replay";
  if (file === "src/shared/savegame.ts") return "savegame";
  if (file === "src/shared/rooms.ts") return "room model";
  if (file.startsWith("src/shared/")) return "shared model";
  if (file.startsWith("src/ai/benchmark")) return "AI benchmark";
  if (file.startsWith("src/ai/policy")) return "AI policy";
  if (file.startsWith("src/ai/")) return "AI runtime";
  if (file.startsWith("src/sdk/benchmark")) return "SDK benchmark";
  if (file.startsWith("src/sdk/commands")) return "SDK command helpers";
  if (file.startsWith("src/sdk/")) return "SDK";
  if (file.startsWith("src/server/")) return "server";
  if (file.startsWith("src/client/net")) return "client net adapter";
  if (file.startsWith("src/client/deployment")) return "client deployment adapter";
  if (file.startsWith("src/client/")) return "client UI";
  if (file.startsWith("src/benchmark-dashboard")) return "benchmark dashboard";
  return "other";
}

function dispositionFor(file: string, kind: FindingKind, snippet: string) {
  if (kind === "nonNull") return nonNullDisposition(file, snippet);
  if (file === "src/shared/sim.ts") {
    if (snippet.includes("Unknown") || snippet.includes("Need ") || snippet.includes("cannot") || snippet.includes("requires") || snippet.includes("already")) {
      return "raw sim fail-loud direct-command invariant; external/player/AI frame paths must validate before reaching it";
    }
    return "simulation model invariant";
  }
  if (file === "src/shared/sim/frame.ts") return "command-frame tick invariant; stale issuers normalize before raw sim";
  if (file === "src/shared/sim/command-validation.ts") return "command admission boundary";
  if (file.startsWith("src/shared/net/")) return "network message decode boundary";
  if (file === "src/shared/replay.ts") return "debug replay contract boundary";
  if (file === "src/shared/savegame.ts") return "savegame contract boundary";
  if (file === "src/shared/rooms.ts") return "room lifecycle contract boundary";
  if (file.startsWith("src/sdk/commands")) return "SDK command intent/frame boundary";
  if (file.startsWith("src/sdk/benchmark") || file.startsWith("src/ai/benchmark")) return "benchmark contract boundary";
  if (file.startsWith("src/sdk/")) return "SDK API contract boundary";
  if (file.startsWith("src/ai/policy") || file.startsWith("src/ai/runtime")) return "AI script/policy input invariant";
  if (file === "src/server/room-host.ts" && (snippet.includes("Hosted command rejected") || snippet === "throw error;")) return "hosted command admission boundary";
  if (file.startsWith("src/server/")) return "server API/room boundary";
  if (file.startsWith("src/client/net") || file.startsWith("src/client/deployment") || file === "src/client/game-adapter.ts") return "client adapter boundary";
  if (file.startsWith("src/client/")) return "client DOM/render invariant";
  if (file.startsWith("src/benchmark-dashboard")) return "dashboard UI/API boundary";
  return "model or tooling invariant";
}

function nonNullDisposition(file: string, snippet: string) {
  if (file.startsWith("src/ai/policy")) return "AI policy guarded lookup; review when changing adjacent decision logic";
  if (file.startsWith("src/shared/sim")) return "simulation local invariant under noUncheckedIndexedAccess";
  if (file.startsWith("src/sdk/commands")) return "SDK frame hook index invariant";
  if (file.startsWith("src/sdk/benchmark") || file.startsWith("src/ai/benchmark")) return "benchmark accumulator invariant";
  if (file.startsWith("src/client/")) return "client DOM/render local invariant";
  if (file.startsWith("src/shared/")) return "shared model local invariant";
  if (file.startsWith("src/sdk/")) return "SDK builder/local invariant";
  if (file.startsWith("src/ai/")) return "AI runtime/playtest local invariant";
  return "local invariant";
}

function summarize(findings: Finding[]) {
  const byDisposition = new Map<string, number>();
  const byArea = new Map<string, number>();
  const byKind = new Map<FindingKind, number>();
  for (const finding of findings) {
    byDisposition.set(finding.disposition, (byDisposition.get(finding.disposition) ?? 0) + 1);
    byArea.set(finding.area, (byArea.get(finding.area) ?? 0) + 1);
    byKind.set(finding.kind, (byKind.get(finding.kind) ?? 0) + 1);
  }
  return {
    total: findings.length,
    byKind: sortedObject(byKind),
    byArea: sortedObject(byArea),
    byDisposition: sortedObject(byDisposition),
  };
}

function markdown(summary: ReturnType<typeof summarize>, findings: Finding[]) {
  const lines = [
    "# Crash Inventory",
    "",
    `Generated from \`${relative(ROOT)}\` production TypeScript sources.`,
    "",
    "## Summary",
    "",
    `- Total findings: ${summary.total}`,
    `- Throws: ${summary.byKind.throw ?? 0}`,
    `- Non-null assertions: ${summary.byKind.nonNull ?? 0}`,
    "",
    "## By Area",
    "",
    "| Area | Count |",
    "| --- | ---: |",
    ...Object.entries(summary.byArea).map(([area, count]) => `| ${escapeCell(area)} | ${count} |`),
    "",
    "## By Disposition",
    "",
    "| Disposition | Count |",
    "| --- | ---: |",
    ...Object.entries(summary.byDisposition).map(([disposition, count]) => `| ${escapeCell(disposition)} | ${count} |`),
    "",
    "## Findings",
    "",
    "| Location | Kind | Area | Disposition | Snippet |",
    "| --- | --- | --- | --- | --- |",
    ...findings.map((finding) => `| \`${finding.file}:${finding.line}:${finding.column}\` | ${finding.kind} | ${escapeCell(finding.area)} | ${escapeCell(finding.disposition)} | \`${escapeCell(finding.snippet)}\` |`),
  ];
  return lines.join("\n");
}

function sortedObject<K extends string>(map: Map<K, number>): Record<K, number> {
  return Object.fromEntries([...map.entries()].sort(([left], [right]) => left.localeCompare(right))) as Record<K, number>;
}

function compareFinding(left: Finding, right: Finding) {
  return left.file.localeCompare(right.file) || left.line - right.line || left.column - right.column || left.kind.localeCompare(right.kind);
}

function relative(filePath: string) {
  return path.relative(ROOT, filePath) || ".";
}

function escapeCell(value: string) {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

main();
