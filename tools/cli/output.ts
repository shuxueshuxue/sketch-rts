// Every subcommand ends the same way: a table for people, or one JSON object on the last line with --json, and an exit
// code: 0 passed, 1 the check found something (a new failure, a dead script), 2 usage or environment error.

export const EXIT = { ok: 0, found: 1, error: 2 } as const;

export function table(headers: readonly string[], rows: readonly (readonly (string | number)[])[]) {
  const cells = [headers, ...rows].map((row) => row.map(String));
  const widths = headers.map((_, column) => Math.max(...cells.map((row) => [...(row[column] ?? "")].length)));
  const line = (row: readonly string[]) => row.map((cell, column) => cell.padEnd(widths[column]!)).join("  ").trimEnd();
  return [line(cells[0]!), widths.map((width) => "-".repeat(width)).join("  "), ...cells.slice(1).map(line)].join("\n");
}

export function emit(json: boolean, human: string, data: unknown) {
  if (json) process.stdout.write(`${JSON.stringify(data)}\n`);
  else process.stdout.write(`${human}\n`);
}

/** Progress for people goes to stderr, so --json stdout stays a single object. */
export function progress(message: string) {
  process.stderr.write(`[sketch] ${message}\n`);
}
