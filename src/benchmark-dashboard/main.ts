import type { BenchmarkDashboardRunDetailPage, BenchmarkDashboardRunPage, BenchmarkDashboardRunSummary } from "../ai/benchmark/dashboard-store";
import { browserLanguages, detectLocale, type Locale } from "../client/i18n";
import type { BenchmarkMatchReport, BenchmarkPlayerResult } from "../sdk/benchmark";
import { joinPublicPath } from "../shared/deployment-base";
import { DEFAULT_MATCHES_PER_PAGE, DEFAULT_RUNS_PER_PAGE } from "./page-size";
import { matchWarnings } from "./warnings";
import { campRoleSummary, playerRaceSummaryCells, playerSetupCells, runListMeta, runMatchesTag, runTags } from "./view-model";
import "./styles.css";

type DashboardState = {
  runs: BenchmarkDashboardRunSummary[];
  tags: string[];
  selectedRun: BenchmarkDashboardRunDetailPage | null;
  selectedTag: string;
  runPage: number;
  runPageSize: number;
  totalRuns: number;
  totalRunPages: number;
  matchPage: number;
  matchPageSize: number;
  totalMatches: number;
  totalMatchPages: number;
  loading: boolean;
  error: string | null;
};

const DASHBOARD_TEXT = {
  en: {
    aiVersion: "ai version",
    all: "all",
    baseBuilds: "base builds",
    building: "building",
    campBands: "camp bands",
    campRoles: "camp roles",
    camps: "camps",
    cpu: "cpu",
    cpuTime: "cpu time",
    creep: "creep",
    enemyExpansionHit: "enemy expansion hit",
    enemyKills: "enemy kills",
    eventDisconnected: "Benchmark dashboard event stream disconnected.",
    events: "events",
    finalBuildings: "final buildings",
    finalSupply: "final supply",
    firstExpansionMining: "first expansion mining",
    firstFight: "first fight",
    games: "games",
    gold: "gold",
    goldIncome: "gold income",
    goldMines: "gold mines",
    goldSpent: "gold spent",
    itemKinds: "item kinds",
    itemPickups: "item pickups",
    items: "items",
    itemUses: "item uses",
    killedByNeutral: "killed by neutral",
    loading: "Running or loading benchmark...",
    mapDetail: "map detail",
    maps: "maps",
    mercCamps: "merc camps",
    mercs: "mercs",
    mine: "mine",
    moonWellHealing: "moon well healing",
    moonWells: "moon wells",
    neutralKills: "neutral kills",
    noReports: "No benchmark reports found.",
    none: "none",
    noRunsForTag: "No benchmark runs for this tag.",
    notAvailable: "n/a",
    ownExpansionHit: "own expansion hit",
    peakSupply: "peak supply",
    players: "players",
    race: "race",
    refresh: "Refresh",
    scoreControl: "1v1 score control",
    size: "size",
    starUnits: "star units",
    title: "Benchmark",
    towerBuilds: "tower builds",
    unit: "unit",
    unitLosses: "unit losses",
    untagged: "untagged",
    upgradeTimings: "upgrade timings",
    wall: "wall",
    wallTime: "wall time",
  },
  zh: {
    aiVersion: "AI 版本",
    all: "全部",
    baseBuilds: "基地建造",
    building: "建筑",
    campBands: "野怪营地分层",
    campRoles: "营地角色",
    camps: "营地",
    cpu: "CPU",
    cpuTime: "CPU 时间",
    creep: "野怪",
    enemyExpansionHit: "攻击敌方分矿",
    enemyKills: "击杀敌方单位",
    eventDisconnected: "Benchmark dashboard 事件流已断开。",
    events: "次",
    finalBuildings: "最终建筑",
    finalSupply: "最终人口",
    firstExpansionMining: "首次分矿采集",
    firstFight: "首次交战",
    games: "局",
    gold: "金矿",
    goldIncome: "金矿收入",
    goldMines: "金矿点",
    goldSpent: "金矿支出",
    itemKinds: "物品类型",
    itemPickups: "拾取物品",
    items: "物品",
    itemUses: "使用物品",
    killedByNeutral: "被野怪击杀",
    loading: "正在运行或加载 benchmark...",
    mapDetail: "地图细节",
    maps: "地图",
    mercCamps: "雇佣兵营地",
    mercs: "雇佣营",
    mine: "矿",
    moonWellHealing: "月井治疗",
    moonWells: "月井",
    neutralKills: "击杀野怪",
    noReports: "没有找到 benchmark 报告。",
    none: "无",
    noRunsForTag: "这个标签下没有 benchmark run。",
    notAvailable: "不可用",
    ownExpansionHit: "己方分矿被打",
    peakSupply: "峰值人口",
    players: "玩家",
    race: "种族",
    refresh: "刷新",
    scoreControl: "1v1 分数控制组",
    size: "尺寸",
    starUnits: "星级单位",
    title: "Benchmark",
    towerBuilds: "防御塔建造",
    unit: "单位",
    unitLosses: "单位损失",
    untagged: "未标记",
    upgradeTimings: "升级时间",
    wall: "墙钟",
    wallTime: "墙钟时间",
  },
} as const satisfies Record<Locale, Record<string, string>>;

type DashboardTextKey = keyof typeof DASHBOARD_TEXT.en;

const appRoot = document.querySelector<HTMLDivElement>("#benchmark-app");
if (!appRoot) throw new Error("missing benchmark app root");
const root: HTMLDivElement = appRoot;
const locale = detectLocale(browserLanguages());
document.documentElement.lang = locale;
document.title = text("title");

const state: DashboardState = {
  runs: [],
  tags: [],
  selectedRun: null,
  selectedTag: "all",
  runPage: 1,
  runPageSize: DEFAULT_RUNS_PER_PAGE,
  totalRuns: 0,
  totalRunPages: 1,
  matchPage: 1,
  matchPageSize: DEFAULT_MATCHES_PER_PAGE,
  totalMatches: 0,
  totalMatchPages: 1,
  loading: false,
  error: null,
};

void loadDashboard();
connectDashboardEvents();

async function loadDashboard(options: { showLoading?: boolean; preserveSelection?: boolean } = {}) {
  const selectedId = options.preserveSelection ? state.selectedRun?.id : undefined;
  if (options.showLoading ?? true) {
    state.loading = true;
    render();
  }
  try {
    const page = await requestJson<BenchmarkDashboardRunPage>(benchmarkRunsPagePath());
    state.runs = page.runs;
    state.tags = page.tags;
    state.runPage = page.page;
    state.runPageSize = page.pageSize;
    state.totalRuns = page.totalRuns;
    state.totalRunPages = page.totalPages;
    const selected = (selectedId ? state.runs.find((run) => run.id === selectedId) : undefined) ?? state.runs[0];
    if (!selected || selected.id !== selectedId) state.matchPage = 1;
    state.selectedRun = selected ? await requestRunDetail(selected.id) : null;
    syncMatchPageState(state.selectedRun);
    state.error = null;
  } catch (error) {
    state.error = errorMessage(error);
  } finally {
    state.loading = false;
    render();
  }
}

async function selectRun(id: string, options: { resetMatchPage?: boolean } = {}) {
  state.loading = true;
  state.error = null;
  if (options.resetMatchPage ?? true) state.matchPage = 1;
  render();
  try {
    state.selectedRun = await requestRunDetail(id);
    syncMatchPageState(state.selectedRun);
  } catch (error) {
    state.error = errorMessage(error);
  } finally {
    state.loading = false;
    render();
  }
}

async function requestRunDetail(id: string) {
  return requestJson<BenchmarkDashboardRunDetailPage>(benchmarkRunDetailPath(id));
}

function render() {
  const tags = state.tags;
  if (state.selectedTag !== "all" && !tags.includes(state.selectedTag)) state.selectedTag = "all";
  const selectedId = state.selectedRun && runMatchesTag(state.selectedRun, state.selectedTag) ? state.selectedRun.id : state.runs[0]?.id ?? "";
  root.innerHTML = `
    <main class="dashboard-shell">
      <aside class="run-list">
        <div class="panel-head">
          <div>
            <span class="eyebrow">AI Lab</span>
            <h1>${escapeHtml(text("title"))}</h1>
          </div>
          <button type="button" data-refresh ${state.loading ? "disabled" : ""}>${escapeHtml(text("refresh"))}</button>
        </div>
        <div class="tag-filter">
          ${tagButton("all", tags.length === 0 ? text("all") : `${text("all")} ${tags.length}`, state.selectedTag)}
          ${tags.map((tag) => tagButton(tag, tag, state.selectedTag)).join("")}
        </div>
        <div class="run-stack">
          ${state.runs.length === 0 ? `<div class="empty">${escapeHtml(text("noRunsForTag"))}</div>` : state.runs.map((run) => runListItem(run, selectedId)).join("")}
        </div>
        ${state.totalRunPages > 1 ? runPager(state.runPage, state.totalRunPages, state.totalRuns) : ""}
      </aside>
      <section class="detail-panel">
        ${state.error ? `<div class="error">${escapeHtml(state.error)}</div>` : ""}
        ${state.loading ? `<div class="loading">${escapeHtml(text("loading"))}</div>` : ""}
        ${state.selectedRun ? runDetail(state.selectedRun) : `<div class="empty detail-empty">${escapeHtml(text("noReports"))}</div>`}
      </section>
    </main>
  `;
  root.querySelector("[data-refresh]")?.addEventListener("click", () => void loadDashboard());
  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-tag]")) {
    button.addEventListener("click", () => {
      state.selectedTag = button.dataset.tag ?? "all";
      state.runPage = 1;
      state.matchPage = 1;
      void loadDashboard({ showLoading: false, preserveSelection: false });
    });
  }
  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-run-id]")) {
    button.addEventListener("click", () => void selectRun(button.dataset.runId ?? ""));
  }
  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-run-page]")) {
    button.addEventListener("click", () => {
      state.runPage = Number(button.dataset.runPage);
      state.matchPage = 1;
      void loadDashboard({ showLoading: false, preserveSelection: false });
    });
  }
  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-match-page]")) {
    button.addEventListener("click", () => {
      if (!state.selectedRun) return;
      state.matchPage = Number(button.dataset.matchPage);
      void selectRun(state.selectedRun.id, { resetMatchPage: false });
    });
  }
}

function tagButton(tag: string, label: string, selectedTag: string) {
  return `<button type="button" data-tag="${escapeHtml(tag)}" data-selected="${tag === selectedTag}">${escapeHtml(label)}</button>`;
}

function connectDashboardEvents() {
  const events = new EventSource(publicPath("/api/benchmark-dashboard/events"));
  events.addEventListener("benchmark-dashboard-change", () => {
    void loadDashboard({ showLoading: false, preserveSelection: false });
  });
  events.addEventListener("error", () => {
    state.error = text("eventDisconnected");
    render();
  });
}

function runListItem(run: BenchmarkDashboardRunSummary, selectedId: string) {
  return `
    <button type="button" class="run-item" data-run-id="${escapeHtml(run.id)}" data-selected="${run.id === selectedId}">
      <span>${escapeHtml(formatDate(run.createdAt))}</span>
      <strong>${run.primarySummary.wins}/${run.primarySummary.matchCount} ${escapeHtml(summaryLabel(run.primarySummary.name))}</strong>
      <small>${runTags(run).map((tag) => `<b>${escapeHtml(tag)}</b>`).join(" ")}</small>
      <em>${escapeHtml(runListMeta(run, locale))}</em>
    </button>
  `;
}

function runPager(page: number, totalPages: number, totalRuns: number) {
  return `
    <nav class="run-pager" data-dashboard-pager="runs" aria-label="benchmark run pages">
      <button type="button" data-run-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>‹</button>
      <span>${page}/${totalPages} · ${totalRuns}</span>
      <button type="button" data-run-page="${page + 1}" ${page >= totalPages ? "disabled" : ""}>›</button>
    </nav>
  `;
}

function runDetail(run: BenchmarkDashboardRunDetailPage) {
  const visibleEvaluations = state.selectedTag === "all" ? run.report.evaluations : run.report.evaluations.filter((evaluation) => (evaluation.tag ?? "untagged") === state.selectedTag);
  return `
    <div class="detail-head">
      <div>
        <span class="eyebrow">${escapeHtml(run.kind)}</span>
        <h2>${escapeHtml(run.report.name)}</h2>
      </div>
      <div class="run-meta">
        <span>${escapeHtml(run.seed)}</span>
        <strong>${escapeHtml(text("wall"))} ${formatMs(run.report.elapsedMs)} · ${escapeHtml(text("cpu"))} ${formatMs(run.report.cpuMs)}</strong>
      </div>
    </div>
    <div class="summary-grid">
      ${run.evaluationSummaries.map((summary) => summaryCell(summaryLabel(summary.name), summary.wins, summary.matchCount, summary.successRate)).join("")}
      ${playerRaceSummaryCells(run).map((summary) => summaryCell(summary.label, summary.wins, summary.matches, summary.winRate)).join("")}
      <div><span>${escapeHtml(text("maps"))}</span><strong>${run.selectedRichScoreMapIds.length}/${run.mapPoolSize}</strong></div>
      <div><span>${escapeHtml(text("games"))}</span><strong>${run.report.matchCount}</strong></div>
      <div><span>${escapeHtml(text("wallTime"))}</span><strong>${formatMs(run.report.elapsedMs)}</strong></div>
      <div><span>${escapeHtml(text("cpuTime"))}</span><strong>${formatMs(run.report.cpuMs)}</strong></div>
    </div>
    <details class="map-strip-detail">
      <summary>${run.selectedRichScoreMapIds.length}/${run.mapPoolSize} ${escapeHtml(text("maps"))}</summary>
      <div class="map-strip">${run.selectedRichScoreMapIds.map((mapId) => `<span>${escapeHtml(mapId)}</span>`).join("")}</div>
    </details>
    <div class="evaluation-list">
      ${visibleEvaluations
        .map(
          (evaluation) => `
            <section class="evaluation">
              <header><strong>${escapeHtml(evaluation.name)}</strong><em>${escapeHtml(evaluation.tag ?? text("untagged"))}</em><span>${evaluation.matchCount} ${escapeHtml(text("games"))} · ${escapeHtml(text("wall"))} ${formatMs(evaluation.elapsedMs)} · ${escapeHtml(text("cpu"))} ${formatMs(evaluation.cpuMs)}</span></header>
              ${evaluation.matches.map(matchDetail).join("")}
            </section>
          `,
        )
        .join("")}
    </div>
    ${run.totalMatchPages > 1 ? matchPager(run.matchPage, run.totalMatchPages, run.totalMatches) : ""}
  `;
}

function matchPager(page: number, totalPages: number, totalMatches: number) {
  return `
    <nav class="match-pager" data-dashboard-pager="matches" aria-label="benchmark match pages">
      <button type="button" data-match-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>‹</button>
      <span>${page}/${totalPages} · ${totalMatches} ${escapeHtml(text("games"))}</span>
      <button type="button" data-match-page="${page + 1}" ${page >= totalPages ? "disabled" : ""}>›</button>
    </nav>
  `;
}

function summaryCell(label: string, wins: number, total: number, rate: number) {
  return `<div><span>${escapeHtml(label)}</span><strong>${wins}/${total}</strong><em>${Math.round(rate * 100)}%</em></div>`;
}

function scoreLabel(name: string) {
  return name.replace(/\s*score$/i, "");
}

function summaryLabel(name: string) {
  return name === "1v1 score control" ? text("scoreControl") : scoreLabel(name);
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
        <span>${match.result.gameSecond}s · ${escapeHtml(text("cpu"))} ${formatMs(match.cpuMs)}</span>
      </summary>
      <div class="match-body">
        ${warnings.length > 0 ? `<div class="warning-strip">${warnings.map((warning) => `<strong>${escapeHtml(warning)}</strong>`).join("")}</div>` : ""}
        <div class="setup-grid">
          <div><span>${escapeHtml(text("size"))}</span><strong>${match.setup.map.width}x${match.setup.map.height}</strong></div>
          <div><span>${escapeHtml(text("gold"))}</span><strong>${match.setup.map.goldMineCount}</strong></div>
          <div><span>${escapeHtml(text("camps"))}</span><strong>${match.setup.map.neutralCamps.camps.length}</strong></div>
          <div><span>${escapeHtml(text("mercs"))}</span><strong>${match.setup.map.mercenaryCamps.length}</strong></div>
          <div><span>${escapeHtml(text("items"))}</span><strong>${match.setup.map.items.total}</strong></div>
        </div>
        <div class="setup-detail">
          <section>
            <h3>${escapeHtml(text("mapDetail"))}</h3>
            <div class="metric"><span>${escapeHtml(text("goldMines"))}</span><strong>${escapeHtml(match.setup.map.goldMines.map((mine) => `${mine.id}@${Math.round(mine.x)},${Math.round(mine.y)}`).join(", "))}</strong></div>
            <div class="metric"><span>${escapeHtml(text("campBands"))}</span><strong>${escapeHtml(campBands(match))}</strong></div>
            <div class="metric"><span>${escapeHtml(text("campRoles"))}</span><strong>${campRoleSummary(match.setup.map.neutralCamps, locale)}</strong></div>
            <div class="metric"><span>${escapeHtml(text("mercCamps"))}</span><strong>${escapeHtml(match.setup.map.mercenaryCamps.map((camp) => `${camp.id}:${camp.hireKind}x${camp.stock}`).join(", ") || text("none"))}</strong></div>
            <div class="metric"><span>${escapeHtml(text("itemKinds"))}</span><strong>${escapeHtml(itemKinds(match))}</strong></div>
          </section>
          <section>
            <h3>${escapeHtml(text("players"))}</h3>
            ${Object.entries(match.setup.players)
              .map(
                ([owner, player]) => setupPlayerRow(owner, player),
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

function setupPlayerRow(owner: string, player: BenchmarkMatchReport["setup"]["players"][string]) {
  return `
    <div class="setup-player">
      <strong>${escapeHtml(owner)}</strong>
      ${playerSetupCells(player, text("notAvailable")).map((value) => `<span>${escapeHtml(value)}</span>`).join("")}
    </div>
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
    [text("aiVersion"), player.aiVersion],
    [text("race"), player.race],
    [text("firstExpansionMining"), second(player.firstExpansionMiningSecond)],
    [text("firstFight"), second(player.firstEnemyEngagementSecond)],
    [text("enemyExpansionHit"), second(player.firstEnemyExpansionAttackSecond)],
    [text("ownExpansionHit"), second(player.firstOwnExpansionAttackedSecond)],
    [text("baseBuilds"), player.baseBuildCount],
    [text("neutralKills"), player.neutralUnitKills],
    [text("enemyKills"), player.enemyUnitKills],
    [text("unitLosses"), player.unitsLost],
    [text("killedByNeutral"), player.unitsKilledByNeutral],
    [text("towerBuilds"), player.defenseTowerBuildCount],
    [text("moonWells"), player.moonWellBuildCount],
    [text("moonWellHealing"), `${player.moonWellHealingEvents} ${text("events")} / ${player.moonWellHealingHp} hp`],
    [text("itemPickups"), player.itemPickupCount],
    [text("itemUses"), player.itemUseCount],
    [text("peakSupply"), player.peakSupply],
    [text("finalSupply"), player.finalSupply],
    [text("finalBuildings"), player.finalBuildingCount],
    [text("goldIncome"), `${player.totalGoldIncome} (${player.goldMineIncome} ${text("mine")} + ${player.creepBountyIncome} ${text("creep")})`],
    [text("goldSpent"), `${player.totalGoldSpent} (${player.unitTrainingGoldSpent} ${text("unit")} + ${player.buildingGoldSpent} ${text("building")})`],
    [text("upgradeTimings"), upgrades || text("none")],
    [text("starUnits"), stars || text("none")],
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

function publicPath(pathname: string) {
  return joinPublicPath(import.meta.env.BASE_URL, pathname);
}

function benchmarkRunsPagePath() {
  const params = new URLSearchParams({
    page: String(state.runPage),
    pageSize: String(state.runPageSize),
  });
  if (state.selectedTag !== "all") params.set("tag", state.selectedTag);
  return publicPath(`/api/benchmark-dashboard/runs?${params.toString()}`);
}

function benchmarkRunDetailPath(id: string) {
  const params = new URLSearchParams({
    matchPage: String(state.matchPage),
    matchPageSize: String(state.matchPageSize),
  });
  if (state.selectedTag !== "all") params.set("tag", state.selectedTag);
  return publicPath(`/api/benchmark-dashboard/runs/${encodeURIComponent(id)}?${params.toString()}`);
}

function syncMatchPageState(run: BenchmarkDashboardRunDetailPage | null) {
  state.matchPage = run?.matchPage ?? 1;
  state.matchPageSize = run?.matchPageSize ?? DEFAULT_MATCHES_PER_PAGE;
  state.totalMatches = run?.totalMatches ?? 0;
  state.totalMatchPages = run?.totalMatchPages ?? 1;
}

function second(value: number | null) {
  return value === null ? text("none") : `${value}s`;
}

function formatMs(value: number | undefined) {
  return value === undefined ? text("notAvailable") : `${value.toFixed(1)}ms`;
}

function campBands(match: BenchmarkMatchReport) {
  const bands = match.setup.map.neutralCamps.bands;
  return `green:${bands.green}, orange:${bands.orange}, red:${bands.red}`;
}

function itemKinds(match: BenchmarkMatchReport) {
  const entries = Object.entries(match.setup.map.items.byKind);
  return entries.length === 0 ? text("none") : entries.map(([kind, count]) => `${kind}:${count}`).join(", ");
}

function text(key: DashboardTextKey) {
  return DASHBOARD_TEXT[locale][key];
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
