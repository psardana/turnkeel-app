import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keys } from '@/lib/queries';
import { useWorkspaceStream } from './use-workspace-stream';

/** Stands in for the browser's EventSource: the test says when it opens. */
class FakeEventSource {
  static readonly made: FakeEventSource[] = [];
  readyState = 0;
  readonly url: string;
  private readonly listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.made.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.readyState = 2;
  }

  emit(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: '', lastEventId: '' } as MessageEvent<string>);
    }
  }

  open(): void {
    this.readyState = 1;
    this.emit('open');
  }
}

describe('the workspace stream and what the app knows about the person', () => {
  beforeEach(() => {
    FakeEventSource.made.length = 0;
    vi.stubGlobal('EventSource', FakeEventSource);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads `me` again the first time the stream of a workspace opens', async () => {
    const queryClient = new QueryClient();
    // What the app holds from before: the person as a Member. It is still fresh, so
    // nothing reads it again by itself.
    queryClient.setQueryData(keys.me, { role: 'member' });
    const fetchMe = vi.fn(() => Promise.resolve({ role: 'viewer' }));

    function Workspace({ slug }: { slug: string }) {
      const state = useWorkspaceStream(slug);
      // The layout's standing reader of `me`, as in the app.
      const me = useQuery({ queryKey: keys.me, queryFn: fetchMe, staleTime: 30_000 });
      return (
        <p>
          {state} {me.data?.role}
        </p>
      );
    }
    const view = render(
      <QueryClientProvider client={queryClient}>
        <Workspace slug="acme" />
      </QueryClientProvider>,
    );
    expect(FakeEventSource.made).toHaveLength(1);
    expect(screen.getByText('connecting member')).toBeInTheDocument();
    expect(fetchMe).not.toHaveBeenCalled();

    // A role change that was made while this person was elsewhere is read now.
    act(() => FakeEventSource.made[0]?.open());
    await waitFor(() => expect(screen.getByText('open viewer')).toBeInTheDocument());
    expect(fetchMe).toHaveBeenCalledTimes(1);

    // Another workspace is another stream, and its first open reads `me` again.
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <Workspace slug="globex" />
      </QueryClientProvider>,
    );
    expect(FakeEventSource.made).toHaveLength(2);
    act(() => FakeEventSource.made[1]?.open());
    await waitFor(() => expect(fetchMe).toHaveBeenCalledTimes(2));
    view.unmount();
  });
});
