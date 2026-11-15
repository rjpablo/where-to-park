// Collections report: Philippine-time ranges and the shape the screen renders.
// Days are Asia/Manila (UTC+8, no daylight saving), the same clock as a session.

const MANILA_MS = 8 * 3600_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const COLLECTION_LINE_CAP = 200;

export const COLLECTION_METHODS = ['cash', 'gcash', 'maya', 'card', 'other'] as const;
export type CollectionMethod = (typeof COLLECTION_METHODS)[number];

const METHOD_LABELS: Record<CollectionMethod, string> = {
  cash: 'Cash',
  gcash: 'GCash',
  maya: 'Maya',
  card: 'Card',
  other: 'Other',
};

export type RangePreset = 'today' | 'yesterday' | 'last7' | 'month';

export type InstantRange = { from: string; to: string };

export type CollectionLine = {
  id: string;
  at: string;
  listing: string;
  plate: string;
  direction: 'payment' | 'refund';
  method: string;
  amount: number;
  recordedBy: string;
};

export type MethodTotal = { method: CollectionMethod; label: string; amount: number };

export type CollectionsReport = {
  collected: number;
  byMethod: MethodTotal[];
  extraFees: number;
  waived: number;
  refunded: number;
  openBalance: number;
  lines: CollectionLine[];
  linesTruncated: boolean;
};

export type ReportOperator = { id: string; name: string };

export type MembershipRow = {
  operatorId: string;
  role: string;
  createdAt: string;
  name: string | null;
};

/** Manila calendar day (YYYY-MM-DD) of an instant. */
export function manilaToday(now: Date): string {
  return new Date(now.getTime() + MANILA_MS).toISOString().slice(0, 10);
}

export function shiftManilaDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function isRealDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  const [y, m, d] = date.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  return utc.getUTCFullYear() === y && utc.getUTCMonth() === m - 1 && utc.getUTCDate() === d;
}

function startOfManilaDay(date: string): string {
  return new Date(`${date}T00:00:00+08:00`).toISOString();
}

function nextMonthStart(date: string): string {
  const [y, m] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
}

/** Inclusive Manila dates, end exclusive at the start of the next day. */
export function rangeFromDates(start: string, end: string): InstantRange | { error: string } {
  const from = start.trim();
  const to = end.trim();
  if (!isRealDate(from) || !isRealDate(to)) return { error: 'Enter dates as YYYY-MM-DD.' };
  if (to < from) return { error: 'The end date is before the start.' };
  return { from: startOfManilaDay(from), to: startOfManilaDay(shiftManilaDate(to, 1)) };
}

/** Preset ranges. `to` is exclusive. */
export function presetRange(preset: RangePreset, now: Date): InstantRange {
  const today = manilaToday(now);
  if (preset === 'today') return rangeFromDates(today, today) as InstantRange;
  if (preset === 'yesterday') {
    const day = shiftManilaDate(today, -1);
    return rangeFromDates(day, day) as InstantRange;
  }
  if (preset === 'last7') return rangeFromDates(shiftManilaDate(today, -6), today) as InstantRange;
  const monthStart = `${today.slice(0, 8)}01`;
  return {
    from: startOfManilaDay(monthStart),
    to: startOfManilaDay(nextMonthStart(today)),
  };
}

export function peso(amount: number): string {
  const n = Number.isFinite(amount) ? amount : 0;
  const sign = n < 0 ? '-' : '';
  const [whole, frac] = Math.abs(n).toFixed(2).split('.');
  return `₱${sign}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 16 Nov 2026, 14:05 in Philippine time. */
export function formatManilaWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const s = new Date(d.getTime() + MANILA_MS).toISOString();
  const [y, m, day] = s.slice(0, 10).split('-').map(Number);
  return `${day} ${MONTHS[m - 1]} ${y}, ${s.slice(11, 16)}`;
}

export function collectionsError(code: string | null | undefined): string {
  switch (code) {
    case 'not_authenticated':
    case 'Permission denied':
      return 'Owners and managers only.';
    case 'range_required':
    case 'range_invalid':
      return 'Choose a start and an end, with the end on or after the start.';
    case 'not_found':
      return 'That listing is not on this operator.';
    default:
      return code || 'Could not load Collections.';
  }
}

function num(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

/** RPC payload, or `{ error }` when the call was refused or unreadable. */
export function parseCollectionsReport(data: unknown): CollectionsReport | { error: string } {
  if (!data || typeof data !== 'object') return { error: collectionsError(null) };
  const d = data as Record<string, unknown>;
  if (typeof d.error === 'string') return { error: collectionsError(d.error) };
  const methods =
    d.by_method && typeof d.by_method === 'object' ? (d.by_method as Record<string, unknown>) : {};
  const rawLines = Array.isArray(d.lines) ? d.lines : [];
  const lines: CollectionLine[] = [];
  for (const row of rawLines) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const direction =
      r.direction === 'refund' ? 'refund' : r.direction === 'payment' ? 'payment' : null;
    if (!direction) continue;
    lines.push({
      id: String(r.id ?? ''),
      at: typeof r.at === 'string' ? r.at : '',
      listing: typeof r.listing === 'string' ? r.listing : '',
      plate: typeof r.plate === 'string' ? r.plate : '',
      direction,
      method: typeof r.method === 'string' ? r.method : '',
      amount: num(r.amount),
      recordedBy: typeof r.recorded_by === 'string' ? r.recorded_by : '',
    });
  }
  return {
    collected: num(d.collected),
    byMethod: COLLECTION_METHODS.map((method) => ({
      method,
      label: METHOD_LABELS[method],
      amount: num(methods[method]),
    })),
    extraFees: num(d.extra_fees),
    waived: num(d.waived),
    refunded: num(d.refunded),
    openBalance: num(d.open_balance),
    lines,
    linesTruncated: d.lines_truncated === true,
  };
}

export function methodLabel(method: string): string {
  return METHOD_LABELS[method as CollectionMethod] ?? method;
}

/**
 * Owner and manager memberships, earliest first, one row per operator.
 * Staff memberships are left out. A blank name becomes "Parking".
 */
export function reportOperators(rows: MembershipRow[]): ReportOperator[] {
  const sorted = [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const out: ReportOperator[] = [];
  for (const row of sorted) {
    if (row.role !== 'owner' && row.role !== 'manager') continue;
    if (out.some((o) => o.id === row.operatorId)) continue;
    const name = row.name?.trim();
    out.push({ id: row.operatorId, name: name || 'Parking' });
  }
  return out;
}
