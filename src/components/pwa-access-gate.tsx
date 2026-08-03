import type React from 'react';

/** Native applications are already installed; the web file owns this gate. */
export function PwaAccessGate({ children }: { children: React.ReactNode }) {
  return children;
}
