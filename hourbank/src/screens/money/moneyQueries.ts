/**
 * Small read helpers for the money / claim / transaction screens (B3 lane).
 */
import { getDb } from '../../db/client';

/**
 * Km per lesson as used by payout claims: the lesson's own km, else the
 * student's default distance. Map of session id → km (null = unknown).
 */
export function lessonKmBySession(sessionIds: string[]): Map<string, number | null> {
  const out = new Map<string, number | null>();
  if (sessionIds.length === 0) return out;
  const unique = [...new Set(sessionIds)];
  const db = getDb();
  // Chunk to stay well under SQLite's bound-parameter limit.
  for (let i = 0; i < unique.length; i += 400) {
    const chunk = unique.slice(i, i + 400);
    const rows = db.getAllSync<{ id: string; km: number | null }>(
      `SELECT s.id, COALESCE(s.travel_km, st.travel_distance_km) AS km
       FROM sessions s JOIN students st ON st.id = s.student_id
       WHERE s.id IN (${chunk.map(() => '?').join(',')})`,
      chunk
    );
    for (const r of rows) out.set(r.id, r.km);
  }
  return out;
}

/** The top-up ledger row id for a credit package (what /transaction/[id] opens). */
export function topUpEntryIdForPackage(packageId: string): string | null {
  const row = getDb().getFirstSync<{ id: string }>(
    `SELECT id FROM ledger_entries WHERE related_package_id = ? AND type = 'top_up' ORDER BY rowid ASC LIMIT 1`,
    [packageId]
  );
  return row?.id ?? null;
}
