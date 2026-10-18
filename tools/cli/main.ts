// sketch: one entry for the project's tooling (see docs/engineering/cli-and-commands.zh.md).
//   npm run sketch -- <command> [options]      or      bin/sketch <command> [options]
import { helpText, UsageError, type CommandSpec } from "./args";
import { EXIT } from "./output";
import * as benchRoom from "./commands/bench-room";
import * as evidence from "./commands/evidence";
import * as replay from "./commands/replay";
import * as scriptsAudit from "./commands/scripts-audit";
import * as shot from "./commands/shot";
import * as testDiff from "./commands/test-diff";
import * as yatu from "./commands/yatu";

type Command = { spec: CommandSpec; run: (argv: string[]) => Promise<number> };
const COMMANDS: Command[] = [testDiff, benchRoom, replay, scriptsAudit, evidence.push, evidence.get, evidence.check, yatu, shot];

function usage() {
  return ["sketch <command> [options]   (--help after a command for its options)", "", ...COMMANDS.map(({ spec }) => `  ${spec.name.padEnd(16)}${spec.summary}`)].join("\n");
}

async function main(argv: string[]) {
  const command = COMMANDS.find(({ spec }) => {
    const words = spec.name.split(" ");
    return words.every((word, index) => argv[index] === word);
  });
  if (!command) {
    process.stderr.write(`${usage()}\n`);
    return argv.length === 0 || argv[0] === "--help" ? EXIT.ok : EXIT.error;
  }
  const rest = argv.slice(command.spec.name.split(" ").length);
  if (rest.includes("--help")) { process.stdout.write(`${helpText(command.spec)}\n`); return EXIT.ok; }
  return command.run(rest);
}

main(process.argv.slice(2)).then((code) => process.exit(code), (error: unknown) => {
  process.stderr.write(`sketch: ${error instanceof Error ? error.message : String(error)}\n`);
  if (error instanceof UsageError) process.stderr.write(`${usage()}\n`);
  process.exit(EXIT.error);
});
