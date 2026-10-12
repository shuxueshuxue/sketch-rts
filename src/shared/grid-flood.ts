type Workspace = { queue: Int32Array; reached: Uint8Array };
export type GridFloodResult = { reached: Uint8Array; count: number };

/** Four-way breadth-first traversal with fixed right, left, down, up order.
 * The returned bitmap is scratch owned by this grid: consume it before the
 * next traversal. A nested passes callback receives a separate workspace.
 */
export class GridFlood {
  private readonly workspace: Workspace;
  private busy = false;
  private readonly size: number;

  constructor(private readonly cols: number, private readonly rows = cols) {
    this.size = cols * rows;
    this.workspace = this.allocate();
  }

  private allocate(): Workspace {
    return { queue: new Int32Array(this.size), reached: new Uint8Array(this.size) };
  }

  walk(start: number, passes: (index: number) => boolean, into?: number[]): GridFloodResult {
    const primary = !this.busy;
    const { queue, reached } = primary ? this.workspace : this.allocate();
    if (primary) this.busy = true;
    reached.fill(0);
    try {
      if (start < 0 || start >= this.size) return { reached, count: 0 };
      // The initial cell is included unconditionally, as in map generation's
      // original flood. The predicate governs only newly discovered cells.
      reached[start] = 1;
      queue[0] = start;
      let tail = 1;
      const visit = (next: number) => {
        if (reached[next] || !passes(next)) return;
        reached[next] = 1;
        queue[tail++] = next;
      };
      for (let head = 0; head < tail; head++) {
        const index = queue[head]!, col = index % this.cols;
        into?.push(index);
        if (col + 1 < this.cols) visit(index + 1);
        if (col > 0) visit(index - 1);
        if (index + this.cols < this.size) visit(index + this.cols);
        if (index >= this.cols) visit(index - this.cols);
      }
      return { reached, count: tail };
    } finally {
      if (primary) this.busy = false;
    }
  }
}
