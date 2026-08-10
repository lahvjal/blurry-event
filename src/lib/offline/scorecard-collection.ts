import { cacheStore } from '@/lib/offline/store';
import type { ScorecardReceipt } from '@/lib/scorecard-receipt';

export type CollectedScorecard = {
  receipt: ScorecardReceipt;
  collectedAt: string;
  collectedBy: string;
};

const COLLECTION_PREFIX = 'scorecard-collection.v1';

function collectionKey(accountId: string, eventId: string): string {
  return `${COLLECTION_PREFIX}:${encodeURIComponent(accountId)}:${encodeURIComponent(eventId)}`;
}

export async function loadCollectedScorecards(
  accountId: string,
  eventId: string,
): Promise<CollectedScorecard[]> {
  const saved = await cacheStore.get<CollectedScorecard[]>(
    collectionKey(accountId, eventId),
  );
  if (!Array.isArray(saved)) return [];
  return saved.filter(
    (card) =>
      card?.receipt?.eventId === eventId &&
      typeof card.receipt.entrantId === 'string' &&
      typeof card.receipt.receiptId === 'string',
  );
}

export async function saveCollectedScorecard(
  accountId: string,
  eventId: string,
  card: CollectedScorecard,
): Promise<CollectedScorecard[]> {
  const current = await loadCollectedScorecards(accountId, eventId);
  const next = [
    card,
    ...current.filter(
      (saved) => saved.receipt.entrantId !== card.receipt.entrantId,
    ),
  ];
  await cacheStore.set(collectionKey(accountId, eventId), next);
  return next;
}
