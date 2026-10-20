import { commandRefusalText } from './command-refusal-text';
import type { RefusalNotice } from './command-refusal-feedback';

/** One short line per cause, with repeated units counted in place. Text is never HTML. */
export class CommandRefusalBar {
  readonly element = document.createElement('div');
  readonly hint = document.createElement('div');
  private rows = new Map<string, { element: HTMLElement; count: number; until: number }>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.element.className = 'command-refusal-bar';
    this.element.setAttribute('role', 'status');
    this.element.setAttribute('aria-live', 'polite');
    this.hint.className = 'command-refusal-hint';
    this.hint.hidden = true;
    document.body.append(this.element, this.hint);
  }

  show(notice: RefusalNotice, locale: 'zh' | 'en') {
    const key = `${notice.owner}:${notice.refusal.reason}:${notice.status}`;
    const now = performance.now();
    const previous = this.rows.get(key);
    const row = previous && previous.until > now ? previous : { element: document.createElement('div'), count: 0, until: 0 };
    row.count += notice.count;
    row.until = now + 4000;
    row.element.dataset.reason = notice.refusal.reason;
    row.element.dataset.status = notice.status;
    const prefix = notice.status === 'waiting' ? (locale === 'zh' ? '等待：' : 'Waiting: ') : '';
    row.element.textContent = `${prefix}${commandRefusalText(notice.refusal, locale)}${row.count > 1 ? ` ×${row.count}` : ''}`;
    this.rows.set(key, row);
    this.element.append(row.element);
    while (this.rows.size > 3) {
      const first = this.rows.keys().next().value!;
      this.rows.get(first)!.element.remove(); this.rows.delete(first);
    }
    this.expire();
  }

  showText(text: string) {
    // For non-command UI errors whose wording is already localized.
    const row = document.createElement('div'); row.textContent = text;
    const prior = this.rows.get('ui'); prior?.element.remove();
    this.rows.set('ui', { element: row, count: 1, until: performance.now() + 4000 });
    this.element.append(row); this.expire();
  }

  hover(text: string | undefined, point?: { x: number; y: number }) {
    this.hint.hidden = !text || !point;
    if (!text || !point) return;
    this.hint.textContent = text;
    this.hint.style.left = `${Math.max(8, Math.min(window.innerWidth - 330, point.x + 18))}px`;
    this.hint.style.top = `${Math.min(window.innerHeight - 50, point.y + 25)}px`;
  }

  reset() {
    if (this.timer) clearTimeout(this.timer);
    this.rows.clear(); this.element.replaceChildren(); this.hint.hidden = true;
  }

  private expire() {
    if (this.timer) clearTimeout(this.timer);
    const now = performance.now();
    for (const [key, row] of this.rows) if (row.until <= now) { row.element.remove(); this.rows.delete(key); }
    if (this.rows.size) this.timer = setTimeout(() => this.expire(), Math.max(1, Math.min(...[...this.rows.values()].map(row => row.until)) - now));
  }
}
