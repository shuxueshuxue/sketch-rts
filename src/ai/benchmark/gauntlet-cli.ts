import { AI_GAUNTLET_V2, type AiGauntletCatalog, type AiGauntletMatch } from "./gauntlet";

export type GauntletPlaytestReplay = {
  args: string[];
  command: string;
};

export type GauntletPlaytestDiagnosis = {
  args: string[];
  command: string;
};

export type GauntletReplayReport = {
  failed: boolean;
  playtestName: string;
  lane: string;
  controllerCase: string;
  mapId: string;
  winnerTeam?: string | null;
  tick?: number;
  playtest: GauntletPlaytestReplay;
};

export type GauntletFailureReplayManifest = {
  failureCount: number;
  failures: Array<{
    name: string;
    lane: string;
    controllerCase: string;
    mapId: string;
    winnerTeam?: string | null;
    tick?: number;
    playtest: GauntletPlaytestReplay;
    diagnosis: GauntletPlaytestDiagnosis;
  }>;
};

export function gauntletPlaytestReplay(match: AiGauntletMatch, catalog: Pick<AiGauntletCatalog, "selection" | "selectedRichScoreMapIds">): GauntletPlaytestReplay {
  const args = [
    "new",
    "--file",
    `.playtests/gauntlet-${slug(match.name)}.json`,
    "--from-gauntlet",
    match.name,
    "--gauntlet-seed",
    catalog.selection.seed,
    ...(catalog.selection.mode === "full" ? ["--gauntlet-full"] : ["--gauntlet-map-count", String(catalog.selectedRichScoreMapIds.length)]),
    "--you",
    AI_GAUNTLET_V2,
    "--assist-you",
  ];
  return {
    args,
    command: `npm run play:ai -- ${args.map(shellArg).join(" ")}`,
  };
}

export function gauntletFailureReplayManifest(reports: GauntletReplayReport[]): GauntletFailureReplayManifest {
  const failures = reports
    .filter((report) => report.failed)
    .map((report) => ({
      name: report.playtestName,
      lane: report.lane,
      controllerCase: report.controllerCase,
      mapId: report.mapId,
      ...(report.winnerTeam !== undefined ? { winnerTeam: report.winnerTeam } : {}),
      ...(report.tick !== undefined ? { tick: report.tick } : {}),
      playtest: report.playtest,
      diagnosis: gauntletPlaytestDiagnosis(report),
    }));
  return { failureCount: failures.length, failures };
}

export function gauntletPlaytestDiagnosis(report: Pick<GauntletReplayReport, "playtestName" | "tick" | "playtest">): GauntletPlaytestDiagnosis {
  const args = [
    "diagnose",
    "--file",
    `.playtests/gauntlet-${slug(report.playtestName)}-diagnosis.json`,
    ...diagnosisSetupArgs(report.playtest.args),
    "--assist-you",
    ...(report.tick !== undefined ? ["--checkpoint-ticks", String(report.tick)] : []),
    "--plan-owner",
    AI_GAUNTLET_V2,
    "--inspect-owner",
    AI_GAUNTLET_V2,
  ];
  return {
    args,
    command: `npm run play:ai -- ${args.map(shellArg).join(" ")}`,
  };
}

function diagnosisSetupArgs(playtestArgs: string[]) {
  const copied: string[] = [];
  for (let index = 0; index < playtestArgs.length; index += 1) {
    const value = playtestArgs[index];
    if (value === "--from-gauntlet" || value === "--gauntlet-seed" || value === "--gauntlet-map-count") {
      copied.push(value, playtestArgs[index + 1]!);
      index += 1;
      continue;
    }
    if (value === "--gauntlet-full") copied.push(value);
  }
  return copied;
}

function slug(value: string) {
  return value
    .replaceAll(/([a-z])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
}

function shellArg(value: string) {
  return /^[A-Za-z0-9_./:-]+$/.test(value) ? value : `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
