// Signed-URL cache helpers for private storage images (chat photos). Import-free so the
// unit tests can load it directly.

export type SignedUrlEntry = { url: string; expiresAt: number };

/** Paths that have no URL yet, or whose URL expires within `refreshBeforeMs`. Paths
 *  already being signed are skipped, and each path is returned once. Re-signing a
 *  path that still has a good URL would hand the image a new URI string (the token
 *  differs every time) and make it reload, which shows as flicker. */
export function pathsNeedingUrl(
  paths: readonly string[],
  cache: Readonly<Record<string, SignedUrlEntry | undefined>>,
  inFlight: ReadonlySet<string>,
  now: number,
  refreshBeforeMs: number
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    if (!path || seen.has(path) || inFlight.has(path)) continue;
    seen.add(path);
    const entry = cache[path];
    if (!entry || entry.expiresAt - now <= refreshBeforeMs) out.push(path);
  }
  return out;
}

type MessageLike = { id: string; read_at: string | null; body?: string | null };

/** True when a refetch returned the same messages (ids, order, read state, text), so the
 *  list doesn't need to be replaced and re-rendered. */
export function sameMessages(a: readonly MessageLike[], b: readonly MessageLike[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].id !== b[i].id ||
      a[i].read_at !== b[i].read_at ||
      (a[i].body ?? null) !== (b[i].body ?? null)
    ) {
      return false;
    }
  }
  return true;
}
