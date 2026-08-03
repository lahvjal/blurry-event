export type ScoreRevision = {
  mutationId: string;
  entrantId: string;
  hole: number;
  clientUpdatedAt: string;
  clientVersion: number;
};

export type ServerScoreRevision = {
  entrantId: string;
  hole: number;
  updatedAt: string;
  clientVersion?: number;
  mutationId?: string | null;
};

export function compareScoreRevision(
  left: { clientUpdatedAt: string; clientVersion: number; mutationId?: string },
  right: { clientUpdatedAt: string; clientVersion: number; mutationId?: string },
): number {
  const leftTime = Date.parse(left.clientUpdatedAt);
  const rightTime = Date.parse(right.clientUpdatedAt);
  const byTime =
    Number.isFinite(leftTime) && Number.isFinite(rightTime)
      ? leftTime - rightTime
      : left.clientUpdatedAt.localeCompare(right.clientUpdatedAt);
  if (byTime !== 0) return byTime;
  const byVersion = left.clientVersion - right.clientVersion;
  if (byVersion !== 0) return byVersion;
  return (left.mutationId ?? '').localeCompare(right.mutationId ?? '');
}

export function serverHasCaughtUp(
  local: ScoreRevision,
  server: ServerScoreRevision | undefined,
): boolean {
  if (!server) return false;
  if (server.mutationId === local.mutationId) return true;
  return (
    compareScoreRevision(
      {
        clientUpdatedAt: server.updatedAt,
        clientVersion: server.clientVersion ?? 0,
        mutationId: server.mutationId ?? undefined,
      },
      local,
    ) >= 0
  );
}

/** An acknowledgement is allowed to remove only the exact immutable row. */
export function isExactRevision(
  row: { id: string; generation?: number },
  id: string,
  generation?: number,
): boolean {
  return (
    row.id === id &&
    (generation === undefined || (row.generation ?? 0) === generation)
  );
}
