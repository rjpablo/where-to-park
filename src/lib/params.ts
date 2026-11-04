export function firstParam(value?: string | string[]): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value || undefined;
}
