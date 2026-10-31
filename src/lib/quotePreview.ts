// Rates page price preview: a start date + time (Asia/Manila) and a duration.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const MANILA_MS = 8 * 3600_000;

/** Today's date in Manila (YYYY-MM-DD). */
export function manilaToday(now: Date = new Date()): string {
  return new Date(now.getTime() + MANILA_MS).toISOString().slice(0, 10);
}

/** Current Manila time of day (HH:MM). */
export function manilaTimeNow(now: Date = new Date()): string {
  return new Date(now.getTime() + MANILA_MS).toISOString().slice(11, 16);
}

export type PreviewStart = { startAt: string; error?: undefined } | { error: string };

/** Start of the previewed stay as UTC ISO, from a Manila date and time. */
export function previewStartAt(date: string, time: string): PreviewStart {
  if (!DATE_RE.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime()))
    return { error: 'Date must be YYYY-MM-DD' };
  const m = time.trim().match(TIME_RE);
  if (!m) return { error: 'Start time must be HH:MM (24-hour)' };
  const hh = m[1].padStart(2, '0');
  const d = new Date(`${date}T${hh}:${m[2]}:00+08:00`);
  if (Number.isNaN(d.getTime()) || manilaToday(d) !== date) return { error: 'Not a real date' };
  return { startAt: d.toISOString() };
}

/** Hours to quote: a positive number, or an error. */
export function previewHours(hours: string): number | { error: string } {
  const n = Number(hours);
  if (!hours.trim() || !Number.isFinite(n) || n <= 0) return { error: 'Hours must be more than 0' };
  return n;
}

/** e.g. "Sat, Nov 7, 2026" for the chosen Manila date. */
export function previewDayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00+08:00`);
  if (!DATE_RE.test(date) || Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(d);
}
