const RECEIPT_PREFIX = 'blurry-scorecard:';
const RECEIPT_VERSION = 1 as const;
const HOLE_COUNT = 18;
const MAX_SCORE = 20;
const MAX_QR_LENGTH = 4096;

export type ScorecardEntrantKind = 'team' | 'player';

export type ScorecardReceipt = {
  version: typeof RECEIPT_VERSION;
  eventId: string;
  entrantId: string;
  /** Display-only. The collector always resolves the trusted roster name. */
  entrantName: string;
  entrantKind: ScorecardEntrantKind;
  scores: number[];
  /** Latest source score timestamp represented by this complete card. */
  sourceUpdatedAt: string;
  /** Stable ordering token taken from the source card's latest revision. */
  sourceRevision: number;
  /** Truncated SHA-256 of the canonical receipt body. */
  receiptId: string;
};

type ReceiptBody = {
  v: typeof RECEIPT_VERSION;
  e: string;
  i: string;
  n: string;
  k: ScorecardEntrantKind;
  s: number[];
  u: string;
  r: number;
};

type WireReceipt = ReceiptBody & { c: string };

type RevisionCandidate = {
  entrantId: string;
  updatedAt: string;
  clientVersion?: number;
};

function assertIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 160) {
    throw new Error(`This score QR has an invalid ${label}.`);
  }
}

function validateBody(value: unknown): ReceiptBody {
  if (!value || typeof value !== 'object') {
    throw new Error('This is not a Blurry Golf score QR.');
  }
  const body = value as Partial<ReceiptBody>;
  if (body.v !== RECEIPT_VERSION) {
    throw new Error('This score QR uses an unsupported version.');
  }
  assertIdentifier(body.e, 'event');
  assertIdentifier(body.i, 'entrant');
  assertIdentifier(body.n, 'entrant name');
  if (body.k !== 'team' && body.k !== 'player') {
    throw new Error('This score QR has an invalid entrant type.');
  }
  if (
    !Array.isArray(body.s) ||
    body.s.length !== HOLE_COUNT ||
    !body.s.every(
      (score) => Number.isInteger(score) && score >= 1 && score <= MAX_SCORE,
    )
  ) {
    throw new Error('This score QR does not contain 18 valid hole scores.');
  }
  if (typeof body.u !== 'string' || !Number.isFinite(Date.parse(body.u))) {
    throw new Error('This score QR has an invalid revision time.');
  }
  if (
    !Number.isSafeInteger(body.r) ||
    (body.r ?? -1) < 0 ||
    (body.r ?? Number.MAX_SAFE_INTEGER) > Number.MAX_SAFE_INTEGER - HOLE_COUNT
  ) {
    throw new Error('This score QR has an invalid revision number.');
  }

  return {
    v: RECEIPT_VERSION,
    e: body.e,
    i: body.i,
    n: body.n,
    k: body.k,
    s: [...body.s],
    u: body.u,
    r: body.r as number,
  };
}

async function checksum(body: ReceiptBody): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Secure score receipts are not available in this browser.');
  }
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return [...digest.slice(0, 16)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function toReceipt(body: ReceiptBody, receiptId: string): ScorecardReceipt {
  return {
    version: RECEIPT_VERSION,
    eventId: body.e,
    entrantId: body.i,
    entrantName: body.n,
    entrantKind: body.k,
    scores: [...body.s],
    sourceUpdatedAt: body.u,
    sourceRevision: body.r,
    receiptId,
  };
}

export async function createScorecardReceipt(input: {
  eventId: string;
  entrantId: string;
  entrantName: string;
  entrantKind: ScorecardEntrantKind;
  scores: readonly (number | null)[];
  sourceUpdatedAt: string;
  sourceRevision: number;
}): Promise<{ receipt: ScorecardReceipt; encoded: string }> {
  const body = validateBody({
    v: RECEIPT_VERSION,
    e: input.eventId,
    i: input.entrantId,
    n: input.entrantName,
    k: input.entrantKind,
    s: [...input.scores],
    u: input.sourceUpdatedAt,
    r: input.sourceRevision,
  });
  const receiptId = await checksum(body);
  const wire: WireReceipt = { ...body, c: receiptId };
  return {
    receipt: toReceipt(body, receiptId),
    encoded: `${RECEIPT_PREFIX}${JSON.stringify(wire)}`,
  };
}

export async function decodeScorecardReceipt(raw: string): Promise<ScorecardReceipt> {
  const encoded = raw.trim();
  if (!encoded.startsWith(RECEIPT_PREFIX) || encoded.length > MAX_QR_LENGTH) {
    throw new Error('This is not a Blurry Golf score QR.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded.slice(RECEIPT_PREFIX.length));
  } catch {
    throw new Error('This score QR is damaged or incomplete.');
  }

  const body = validateBody(parsed);
  const receiptId = (parsed as Partial<WireReceipt>).c;
  if (typeof receiptId !== 'string' || !/^[a-f0-9]{32}$/.test(receiptId)) {
    throw new Error('This score QR is missing its integrity check.');
  }
  if ((await checksum(body)) !== receiptId) {
    throw new Error('This score QR was changed after it was created.');
  }
  return toReceipt(body, receiptId);
}

/**
 * Finds the stable source revision for a complete scorecard. Server rows and
 * offline overlays both expose this shape, so remounting the receipt screen
 * does not create a new QR until an actual hole revision changes.
 */
export function scorecardSourceRevision(
  entrantId: string,
  updates: readonly RevisionCandidate[],
  fallbackNow = new Date(),
): { sourceUpdatedAt: string; sourceRevision: number } {
  const candidates = updates
    .filter((update) => update.entrantId === entrantId)
    .map((update) => {
      const timestamp = Date.parse(update.updatedAt);
      const timestampVersion = Number.isFinite(timestamp) ? timestamp * 1_000 : 0;
      const version = Number.isSafeInteger(update.clientVersion)
        ? Math.max(update.clientVersion ?? 0, timestampVersion)
        : timestampVersion;
      return { updatedAt: update.updatedAt, version };
    })
    .filter((candidate) => candidate.version > 0)
    .sort((left, right) => right.version - left.version);

  if (candidates[0]) {
    return {
      sourceUpdatedAt: candidates[0].updatedAt,
      sourceRevision: Math.min(
        candidates[0].version,
        Number.MAX_SAFE_INTEGER - HOLE_COUNT,
      ),
    };
  }

  const fallbackTime = fallbackNow.getTime();
  return {
    sourceUpdatedAt: fallbackNow.toISOString(),
    sourceRevision: Math.min(
      Math.max(0, fallbackTime * 1_000),
      Number.MAX_SAFE_INTEGER - HOLE_COUNT,
    ),
  };
}
