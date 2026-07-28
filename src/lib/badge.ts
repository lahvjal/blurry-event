/**
 * Native stand-in. Metro resolves badge.web.ts on web.
 *
 * A native build would badge through the OS notification APIs, which is a
 * different mechanism — not a gap to fill in here.
 */

export async function setBadge(_count: number): Promise<void> {}

export async function clearBadge(): Promise<void> {}
