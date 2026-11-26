import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState } from 'react';
import { API_BASE, seg } from '@/lib/api';
import { openEventStream, type StreamState } from '@/lib/event-stream';
import { applyStreamMessage, applyStreamReset, keys } from '@/lib/queries';

/**
 * Holds the one live stream of the workspace for this tab and turns its
 * messages into refetches. The workspace layout calls it once; pages read the state
 * through `useStreamState`.
 */
export function useWorkspaceStream(slug: string): StreamState {
  const queryClient = useQueryClient();
  const [state, setState] = useState<StreamState>('connecting');

  useEffect(() => {
    // What the app knows about the person (`me`) is read again the first time this
    // workspace's stream is open. While no stream of a workspace was open, a change of
    // the person's role there reached nobody in this tab, and `me` is otherwise read
    // again only on a message about members. From the open on, the stream covers it.
    let readMeAgain = true;
    const stream = openEventStream(`${API_BASE}/workspaces/${seg(slug)}/stream`, {
      onChange: (message) => applyStreamMessage(queryClient, slug, message),
      onReset: () => applyStreamReset(queryClient, slug),
      // The server refused the stream: the person may have been removed, or the
      // session ended. Reading `me` again shows which.
      onRefused: () => void queryClient.invalidateQueries({ queryKey: keys.me }),
      onState: (next) => {
        setState(next);
        if (next === 'open' && readMeAgain) {
          readMeAgain = false;
          void queryClient.invalidateQueries({ queryKey: keys.me });
        }
      },
    });
    return () => stream.close();
  }, [slug, queryClient]);

  return state;
}

export const StreamStateContext = createContext<StreamState>('connecting');

export const useStreamState = () => useContext(StreamStateContext);
