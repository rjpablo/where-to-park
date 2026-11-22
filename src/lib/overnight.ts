const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** '22:00:00' or '22:00' → '22:00'. Blank when it is not a time. */
export function overnightTimeText(value: unknown): string {
  const match = String(value ?? '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '';
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

/**
 * When overnight is on, the start, the end and a price are required.
 * The two times have to differ so the window is a real stretch of the day.
 */
export function overnightError(
  enabled: boolean,
  start: string,
  end: string,
  price: string
): string | null {
  if (!enabled) return null;
  if (!TIME_RE.test(start.trim())) return 'Enter the overnight start as HH:MM.';
  if (!TIME_RE.test(end.trim())) return 'Enter the overnight end as HH:MM.';
  if (overnightTimeText(start) === overnightTimeText(end)) {
    return 'Overnight start and end have to be different.';
  }
  const amount = Number(price);
  if (!price.trim() || !Number.isFinite(amount) || amount <= 0) {
    return 'Enter an overnight price greater than 0.';
  }
  return null;
}
