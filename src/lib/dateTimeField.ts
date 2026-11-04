// Values the forms already store: a Manila calendar day (YYYY-MM-DD) or a
// 24-hour clock time (HH:MM). The system picker speaks in the device's local
// clock face, so these helpers treat the numbers on that face as the value.

export type DateTimeMode = 'date' | 'time';

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const CLOCK = /^(\d{1,2}):(\d{2})$/;

function manilaToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}

export function defaultPlaceholder(mode: DateTimeMode): string {
  return mode === 'date' ? 'Select date' : 'Select time';
}

/** What the field shows. Dates are a calendar label; times stay HH:MM. */
export function dateTimeLabel(value: string, mode: DateTimeMode): string {
  if (mode === 'time') return normalizePickerValue(value, 'time');
  const day = normalizePickerValue(value, 'date');
  if (!day) return '';
  const [y, m, d] = day.split('-').map(Number);
  const local = new Date(y, m - 1, d);
  if (Number.isNaN(local.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(local);
}

/** A Date the picker can show. Empty dates open on today's Manila calendar day. */
export function pickerDate(value: string, mode: DateTimeMode): Date {
  if (mode === 'time') {
    const m = CLOCK.exec(value.trim());
    const hh = m && Number(m[1]) <= 23 ? Number(m[1]) : 0;
    const mm = m && Number(m[2]) <= 59 ? Number(m[2]) : 0;
    return new Date(2000, 0, 1, hh, mm, 0, 0);
  }
  const source = DAY.test(value) ? value : manilaToday();
  const [, y, mo, d] = DAY.exec(source) as RegExpExecArray;
  // Noon, so a daylight-saving gap at midnight cannot shift the calendar day.
  return new Date(Number(y), Number(mo) - 1, Number(d), 12, 0, 0, 0);
}

/** The form value for a date the user confirmed in the picker. */
export function valueFromPickerDate(date: Date, mode: DateTimeMode): string {
  if (mode === 'time') {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Browser date/time input value, or '' when it isn't one of ours. */
export function normalizePickerValue(raw: string, mode: DateTimeMode): string {
  const v = raw.trim();
  if (!v) return '';
  if (mode === 'date') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
  }
  const m = /^(\d{1,2}):(\d{2})/.exec(v);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return '';
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}
