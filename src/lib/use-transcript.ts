import { useEffect, useState } from 'react';
import * as ipc from '@/lib/ipc';
import type { TranscriptTurn } from '@/types';

export interface TranscriptState {
  /** null while loading; an array (possibly empty) once read. */
  turns: TranscriptTurn[] | null;
  error: string | null;
}

/** Reads a session transcript, re-reading whenever `reloadKey` changes (used by
 *  Refresh on a live session). Passing a null project/session yields an empty,
 *  non-loading result — so callers can invoke the hook unconditionally and only
 *  supply ids when a markdown view is actually shown. */
export function useTranscript(
  projectDir: string | null,
  sessionId: string | null,
  reloadKey = 0,
): TranscriptState {
  const [state, setState] = useState<TranscriptState>({ turns: null, error: null });

  useEffect(() => {
    if (!projectDir || !sessionId) {
      setState({ turns: [], error: null });
      return;
    }
    let cancelled = false;
    setState({ turns: null, error: null });
    ipc.readTranscript(projectDir, sessionId)
      .then((turns) => { if (!cancelled) setState({ turns, error: null }); })
      .catch((e) => { if (!cancelled) setState({ turns: null, error: String(e) }); });
    return () => { cancelled = true; };
  }, [projectDir, sessionId, reloadKey]);

  return state;
}
