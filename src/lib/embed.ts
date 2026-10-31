/**
 * PostgREST returns an embedded view (e.g. public_profiles) as an array, because it can't
 * tell the join is one-to-one; tables with a foreign key come back as an object. Read either.
 */
export function embeddedOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
