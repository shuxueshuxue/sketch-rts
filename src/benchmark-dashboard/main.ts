import type { BenchmarkDashboardRun, BenchmarkDashboardRunSummary } from "../ai/benchmark/dashboard-store";
import type { BenchmarkMatchReport, BenchmarkPlayerResult } from "../sdk/benchmark";
import { matchWarnings } from "./warnings";
import { campRoleSummary, runListMeta } from "./view-model";
import "./styles.css";

type DashboardState = {
  runs: BenchmarkDashboardRunSummary[];
  selectedRun: BenchmarkDashboardRun | null;
  loading: boolean;
  error: string | null;
};

const appRoot = document.querySelector<HTMLDivElement>("#benchmark-app");
if (!appRoot) throw new Error("missing benchmark app root");
const root: HTMLDivElement = appRoot;

const state: DashboardState = { runs: [], selectedRun: null, loading: false, error: null };

void loadDashboard();
connectDashboardEvents();

async function loadDashboard(options: { showLoading?: boolean; preserveSelection?: boolean } = {}) {
  const selectedId = options.preserveSelection ? state.selectedRun?.id : undefined;
  if (options.showLoading ?? true) {
    state.loading = true;
    render();
  }
  try {
    const { runs } = await requestJson<{ runs: BenchmarkDashboardRunSummary[] }>("/api/benchmark-dashboard/runs");
    state.runs = runs;
    const selected = (selectedId ? runs.find((run) => run.id === selectedId) : undefined) ?? runs[0];
    state.selectedRun = selected ? await requestJson<BenchmarkDashboardRun>(`/api/benchmark-dashboard/runs/${encodeURIComponent(selected.id)}`) : null;
    state.error = null;
  } catch (error) {
    state.error = errorMessage(error);
  } finally {
    state.loading = false;
    render();
  }
}

async function selectRun(id: string) {
  state.loading = true;
  state.error = null;
  render();
  try {
    state.selectedRun = await requestJson<BenchmarkDashboardRun>(`/api/benchmark-dashboard/runs/${encodeURIComponent(id)}`);
  } catch (error) {
    state.error = errorMessage(error);
  } finally {
    state.loading = false;
    render();
  }
}

function render() {
  const selectedId = state.selectedRun?.id ?? state.runs[0]?.id ?? "";
  root.innerHTML = `
    <main class="dashboard-shell">
      <aside class="run-list">
        <div class="panel-head">
          <div>
            <span class="eyebrow">AI Lab</span>
            <h1>Benchmark</h1>
          </div>
          <button type="button" data-refresh ${state.loading ? "disabled" : ""}>Refresh</button>
        </div>
        <div class="run-stack">
          ${state.runs.length === 0 ? `<div class="empty">No benchmark runs yet.</div>` : state.runs.map((run) => runListItem(run, selectedId)).join("")}
        </div>
      </aside>
      <section class="detail-panel">
        ${state.error ? `<div class="error">${escapeHtml(state.error)}</div>` : ""}
        ${state.loading ? `<div class="loading">Running or loading benchmark...</div>` : ""}
        ${state.selectedRun ? runDetail(state.selectedRun) : `<div class="empty detail-empty">No benchmark reports found.</div>`}
      </section>
    </main>
  `;
  root.querySelector("[data-refresh]")?.addEventListener("click", () => void loadDashboard());
  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-run-id]")) {
    button.addEventListener("click", () => void selectRun(button.dataset.runId ?? ""));
  }
}

function connectDashboardEvents() {
  const events = new EventSource("/api/benchmark-dashboard/events");
  events.addEventListener("benchmark-dashboard-change", () => {
    void loadDashboard({ showLoading: false, preserveSelection: false });
  });
  events.addEventListener("error", () => {
    state.error = "Benchmark dashboard event stream disconnected.";
    render();
  });
}

function runListItem(run: BenchmarkDashboardRunSummary, selectedId: string) {
  return `
    <button type="button" class="run-item" data-run-id="${escapeHtml(run.id)}" data-selected="${run.id === selectedId}">
      <span>${escapeHtml(formatDate(run.createdAt))}</span>
      <strong>${run.scoreSummary.wins}/${run.scoreSummary.matchCount} ${escapeHtml(scoreLabel(run.scoreSummary.name))}</strong>
      <em>${escapeHtml(runListMeta(run))}</em>
    </button>
  `;
}

function runDetail(run: BenchmarkDashboardRun) {
  return `
    <div class="detail-head">
      <div>
        <span class="eyebrow">${escapeHtml(run.kind)}</span>
        <h2>${escapeHtml(run.report.name)}</h2>
      </div>
      <div class="run-meta">
        <span>${escapeHtml(run.seed)}</span>
        <strong>wall ${formatMs(run.report.elapsedMs)} · cpu ${formatMs(run.report.cpuMs)}</strong>
      </div>
    </div>
    <div class="summary-grid">
      ${summaryCell(scoreLabel(run.scoreSummary.name), run.scoreSummary.wins, run.scoreSummary.matchCount, run.scoreSummary.successRate)}
      ${summaryCell("1v1 score control", run.scoreControlSummary.wins, run.scoreControlSummary.matchCount, run.scoreControlSummary.successRate)}
      ${run.probeSummaries.map((summary) => summaryCell(summary.name, summary.wins, summary.matchCount, summary.successRate)).join("")}
      ${run.combatSummaries.map((summary) => summaryCell(summary.name, summary.wins, summary.matchCount, summary.successRate)).join("")}
      ${summaryCell("1v1 sanity", run.sanitySummary.wins, run.sanitySummary.matchCount, run.sanitySummary.successRate)}
      <div><span>maps</span><strong>${run.selectedRichScoreMapIds.length}/${run.mapPoolSize}</strong></div>
      <div><span>games</span><strong>${run.report.matchCount}</strong></div>
      <div><span>wall time</span><strong>${formatMs(run.report.elapsedMs)}</strong></div>
      <div><span>cpu time</span><strong>${formatMs(run.report.cpuMs)}</strong></div>
    </div>
    <div class="map-strip">${run.selectedRichScoreMapIds.map((mapId) => `<span>${escapeHtml(mapId)}</span>`).join("")}</div>
    <div class="evaluation-list">
      ${run.report.evaluations
        .map(
          (evaluation) => `
            <section class="evaluation">
              <header><strong>${escapeHtml(evaluation.name)}</strong><em>${escapeHtml(evaluation.tag ?? "untagged")}</em><span>${evaluation.matchCount} games · wall ${formatMs(evaluation.elapsedMs)} · cpu ${formatMs(evaluation.cpuMs)}</span></header>
              ${evaluation.matches.map(matchDetail).join("")}
            </section>
          `,
        )
        .join("")}
    </div>
  `;
}

function summaryCell(label: string, wins: number, total: number, rate: number) {
  return `<div><span>${escapeHtml(label)}</span><strong>${wins}/${total}</strong><em>${Math.round(rate * 100)}%</em></div>`;
}

function scoreLabel(name: string) {
  return name.replace(/\s*score$/i, "");
}

function matchDetail(match: BenchmarkMatchReport) {
  const warnings = matchWarnings(match);
  return `
    <details class="match-row">
      <summary>
        <span>${escapeHtml(match.name)}</span>
        <span>${escapeHtml(match.setup.map.name)}</span>
        <strong>${escapeHtml(match.result.winnerTeam)}</strong>
        ${warnings.length > 0 ? `<mark class="match-warning">${escapeHtml(warnings.join(" · "))}</mark>` : ""}
        <span>${match.result.gameSecond}s · cpu ${formatMs(match.cpuMs)}</span>
      </summary>
      <div class="match-body">
        ${warnings.length > 0 ? `<div class="warning-strip">${warnings.map((warning) => `<strong>${escapeHtml(warning)}</strong>`).join("")}</div>` : ""}
        <div class="setup-grid">
          <div><span>size</span><strong>${match.setup.map.width}x${match.setup.map.height}</strong></div>
          <div><span>gold</span><strong>${match.setup.map.goldMineCount}</strong></div>
          <div><span>camps</span><strong>${match.setup.map.neutralCamps.camps.length}</strong></div>
          <div><span>mercs</span><strong>${match.setup.map.mercenaryCamps.length}</strong></div>
          <div><span>items</span><strong>${match.setup.map.items.total}</strong></div>
        </div>
        <div class="setup-detail">
          <section>
            <h3>map detail</h3>
            <div class="metric"><span>gold mines</span><strong>${escapeHtml(match.setup.map.goldMines.map((mine) => `${mine.id}@${Math.round(mine.x)},${Math.round(mine.y)}`).join(", "))}</strong></div>
            <div class="metric"><span>camp bands</span><strong>${escapeHtml(campBands(match))}</strong></div>
            <div class="metric"><span>camp roles</span><strong>${campRoleSummary(match.setup.map.neutralCamps)}</strong></div>
            <div class="metric"><span>merc camps</span><strong>${escapeHtml(match.setup.map.mercenaryCamps.map((camp) => `${camp.id}:${camp.hireKind}x${camp.stock}`).join(", ") || "none")}</strong></div>
            <div class="metric"><span>item kinds</span><strong>${escapeHtml(itemKinds(match))}</strong></div>
          </section>
          <section>
            <h3>players</h3>
            ${Object.entries(match.setup.players)
              .map(
                ([owner, player]) => `
                  <div class="setup-player">
                    <strong>${escapeHtml(owner)}</strong>
                    <span>${escapeHtml(player.team)}</span>
                    <span>${escapeHtml(player.aiVersion)}</span>
                    <span>${escapeHtml(player.race)}</span>
                    <span>${escapeHtml(player.adapter)}</span>
                  </div>
                `,
              )
              .join("")}
          </section>
        </div>
        <div class="player-grid">
          ${Object.entries(match.result.players).map(([owner, player]) => playerBlock(owner, player)).join("")}
        </div>
      </div>
    </details>
  `;
}

function playerBlock(owner: string, player: BenchmarkPlayerResult) {
  const upgrades = Object.entries(player.upgradeSeconds)
    .flatMap(([kind, levels]) => Object.entries(levels ?? {}).map(([level, second]) => `${kind}${level}@${second}s`))
    .join(", ");
  const stars = Object.entries(player.starUnitCounts)
    .map(([level, count]) => `${level} star:${count}`)
    .join(", ");
  const rows: [string, string | number][] = [
    ["ai version", player.aiVersion],
    ["race", player.race],
    ["first expansion mining", second(player.firstExpansionMiningSecond)],
    ["first fight", second(player.firstEnemyEngagementSecond)],
    ["enemy expansion hit", second(player.firstEnemyExpansionAttackSecond)],
    ["own expansion hit", second(player.firstOwnExpansionAttackedSecond)],
    ["base builds", player.baseBuildCount],
    ["neutral kills", player.neutralUnitKills],
    ["enemy kills", player.enemyUnitKills],
    ["unit losses", player.unitsLost],
    ["killed by neutral", player.unitsKilledByNeutral],
    ["tower builds", player.defenseTowerBuildCount],
    ["moon wells", player.moonWellBuildCount],
    ["item pickups", player.itemPickupCount],
    ["item uses", player.itemUseCount],
    ["peak supply", player.peakSupply],
    ["final supply", player.finalSupply],
    ["final buildings", player.finalBuildingCount],
    ["gold income", `${player.totalGoldIncome} (${player.goldMineIncome} mine + ${player.creepBountyIncome} creep)`],
    ["gold spent", `${player.totalGoldSpent} (${player.unitTrainingGoldSpent} unit + ${player.buildingGoldSpent} building)`],
    ["upgrade timings", upgrades || "none"],
    ["star units", stars || "none"],
  ];
  return `
    <article class="player-card">
      <header><strong>${escapeHtml(owner)}</strong><span>${escapeHtml(player.team)}</span></header>
      ${rows.map(([label, value]) => `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`).join("")}
    </article>
  `;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as T;
}

function second(value: number | null) {
  return value === null ? "none" : `${value}s`;
}

function formatMs(value: number | undefined) {
  return value === undefined ? "n/a" : `${value.toFixed(1)}ms`;
}

function campBands(match: BenchmarkMatchReport) {
  const bands = match.setup.map.neutralCamps.bands;
  return `green:${bands.green}, orange:${bands.orange}, red:${bands.red}`;
}

function itemKinds(match: BenchmarkMatchReport) {
  const entries = Object.entries(match.setup.map.items.byKind);
  return entries.length === 0 ? "none" : entries.map(([kind, count]) => `${kind}:${count}`).join(", ");
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}
