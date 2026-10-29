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
