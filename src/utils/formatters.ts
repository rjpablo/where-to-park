/**
 * Format peso amount from numeric(12,2) database value
 * Never uses floats - formats from string or number
 */
export function formatPeso(amount: number | string | null | undefined): string {
  if (amount == null) return '₱0.00';

  const num = typeof amount === 'string' ? parseFloat(amount) : amount;

  if (isNaN(num)) return '₱0.00';

  return `₱${num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

/**
 * Format distance in meters
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }
  return `${(meters / 1000).toFixed(1)}km`;
}

/**
 * Format duration in seconds
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  if (seconds < 3600) {
    return `${Math.round(seconds / 60)}min`;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (minutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${minutes}m`;
}

/** Display and edit times in Asia/Manila (UTC+8, no DST). Persist UTC. */
export const DISPLAY_TIME_ZONE = 'Asia/Manila';

function asDate(date: string | Date | null | undefined): Date | null {
  if (date == null || date === '') return null;
  const then = typeof date === 'string' ? new Date(date) : date;
  return Number.isNaN(then.getTime()) ? null : then;
}

function manilaParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: DISPLAY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value || '';
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  };
}

/**
 * Friendly local clock time, e.g. "Oct 29, 6:47 PM".
 */
export function formatLocalDateTime(date: string | Date | null | undefined): string {
  const then = asDate(date);
  if (!then) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: DISPLAY_TIME_ZONE,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(then);
}

/** Friendly local date, e.g. "Oct 29, 2026". */
export function formatLocalDate(date: string | Date | null | undefined): string {
  const then = asDate(date);
  if (!then) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: DISPLAY_TIME_ZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(then);
}

/** `datetime-local` value in Asia/Manila. */
export function toDatetimeLocalValue(date: string | Date | null | undefined): string {
  const then = asDate(date);
  if (!then) return '';
  const p = manilaParts(then);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Interpret a `datetime-local` string as Asia/Manila and return UTC ISO. */
export function fromDatetimeLocalValue(value: string): string {
  if (!value) return '';
  const normalized = value.length === 16 ? `${value}:00` : value;
  return new Date(`${normalized}+08:00`).toISOString();
}

/**
 * Format relative time (e.g., "updated 5min ago")
 */
export function formatRelativeTime(date: string | Date): string {
  const now = new Date();
  const then = typeof date === 'string' ? new Date(date) : date;
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * Check if timestamp is stale based on threshold
 */
export function isStale(timestamp: string | Date, thresholdMinutes: number): boolean {
  const now = new Date();
  const then = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  const minutes = (now.getTime() - then.getTime()) / 60000;
  return minutes > thresholdMinutes;
}
