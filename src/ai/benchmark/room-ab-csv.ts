/** RFC 4180 cells: embedded quotes are doubled, including JSON-valued cells. */
export function formatRoomAbCsv(rows: readonly (readonly unknown[])[]): string {
  return rows.map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n') + '\r\n';
}
