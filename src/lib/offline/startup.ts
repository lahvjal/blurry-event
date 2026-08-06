export type LocalStartupIdentity = {
  accountId: string | null;
  /** A ready receipt is usable only for the same locally persisted account. */
  preparedAccountId: string | null;
};

/**
 * Selects the account for local startup without consulting the network.
 * A persisted login wins; a ready receipt may stand alone after token expiry,
 * but it can never be replayed underneath a different persisted login.
 */
export function selectLocalStartupIdentity(
  preparedAccountId: string | null,
  storedSessionAccountId: string | null,
): LocalStartupIdentity {
  if (storedSessionAccountId) {
    return {
      accountId: storedSessionAccountId,
      preparedAccountId:
        preparedAccountId === storedSessionAccountId ? preparedAccountId : null,
    };
  }
  return {
    accountId: preparedAccountId,
    preparedAccountId,
  };
}

/** Data required to render is independent of the currently deployed shell ID. */
export function hasCompletePreparedEventData(params: {
  manifestAccountId: string;
  manifestStatus: string;
  selectedEventIds: readonly string[];
  accessAccountId: string | null;
  accessibleEventIds: ReadonlySet<string>;
  snapshotEventIds: ReadonlySet<string>;
}): boolean {
  return (
    params.manifestStatus === 'ready' &&
    params.accessAccountId === params.manifestAccountId &&
    params.selectedEventIds.every(
      (eventId) =>
        params.accessibleEventIds.has(eventId) &&
        params.snapshotEventIds.has(eventId),
    )
  );
}
