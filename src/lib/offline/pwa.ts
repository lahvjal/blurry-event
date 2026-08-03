import {
  INITIAL_PWA_PREPARE_PROGRESS,
  PwaPrepareListener,
  PwaPrepareProgress,
} from '@/lib/offline/pwa-contract';

export type {
  PwaPrepareListener,
  PwaPreparePhase,
  PwaPrepareProgress,
} from '@/lib/offline/pwa-contract';

/** No PWA shell off the web; Metro resolves pwa.web.ts there. */
export function setupPwa(): void {}

/** Native builds are already installed applications. */
export function isStandalonePwa(): boolean {
  return true;
}

export function subscribePwaDisplayMode(_listener: () => void): () => void {
  return () => {};
}

export function subscribePwaPrepareProgress(
  listener: PwaPrepareListener,
): () => void {
  listener({ ...INITIAL_PWA_PREPARE_PROGRESS, phase: 'ready' });
  return () => {};
}

export async function preparePwaShell(): Promise<PwaPrepareProgress> {
  return { ...INITIAL_PWA_PREPARE_PROGRESS, phase: 'ready' };
}
