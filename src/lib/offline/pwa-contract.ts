export type PwaPreparePhase =
  | 'idle'
  | 'registering'
  | 'downloading'
  | 'ready'
  | 'error';

/**
 * Progress for the versioned, application-shell cache. Event data and media
 * report their own progress and can be combined with this by the preparation
 * screen.
 */
export type PwaPrepareProgress = {
  phase: PwaPreparePhase;
  completed: number;
  total: number;
  completedBytes: number;
  totalBytes: number;
  fingerprint: string | null;
  url: string | null;
  error: string | null;
};

export type PwaPrepareListener = (progress: PwaPrepareProgress) => void;

export const INITIAL_PWA_PREPARE_PROGRESS: PwaPrepareProgress = {
  phase: 'idle',
  completed: 0,
  total: 0,
  completedBytes: 0,
  totalBytes: 0,
  fingerprint: null,
  url: null,
  error: null,
};
