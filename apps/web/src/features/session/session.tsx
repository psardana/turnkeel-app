import type { Me, MyWorkspace, ServerInfo } from '@turnkeel/protocol';
import { createContext, useContext } from 'react';

/** Who is signed in and what this server offers. Set by the layout of the signed-in pages. */
export interface Session {
  me: Me;
  server: ServerInfo;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession is used outside the signed-in pages.');
  return session;
}

/** The workspace the URL names, with what the person holds and may do in it. */
export interface WorkspaceSession {
  entry: MyWorkspace;
  /** The slug as the server holds it. */
  slug: string;
  abilities: WorkspaceAbilities;
}

export const WorkspaceContext = createContext<WorkspaceSession | null>(null);

export function useWorkspace(): WorkspaceSession {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) throw new Error('useWorkspace is used outside a workspace page.');
  return workspace;
}

/** The workspace, or null on a page that belongs to no workspace, such as Account. */
export function useOptionalWorkspace(): WorkspaceSession | null {
  return useContext(WorkspaceContext);
}

const LAST_WORKSPACE_KEY = 'turnkeel.workspace';

/** The workspace this browser had open last, so that `/` goes back to it. */
export function rememberWorkspace(slug: string): void {
  try {
    window.localStorage.setItem(LAST_WORKSPACE_KEY, slug);
  } catch {
    // Without storage `/` opens the first workspace.
  }
}

/** Forgets the workspace opened last when it is this one: after Remove demo data, `/` goes elsewhere. */
export function forgetWorkspace(slug: string): void {
  try {
    if (window.localStorage.getItem(LAST_WORKSPACE_KEY) === slug) {
      window.localStorage.removeItem(LAST_WORKSPACE_KEY);
    }
  } catch {
    // Without storage there is nothing to forget.
  }
}

export function lastWorkspace(): string | null {
  try {
    return window.localStorage.getItem(LAST_WORKSPACE_KEY);
  } catch {
    return null;
  }
}

/** Where `/` leads: the workspace opened last, the first one, or the first-run page. */
export function homeWorkspace(me: Me): MyWorkspace | null {
  const last = lastWorkspace();
  return me.workspaces.find((entry) => entry.workspace.slug === last) ?? me.workspaces[0] ?? null;
}

/**
 * Where `/account` leads: Settings, Profile, of the workspace `/` would open,
 * or null to keep the page at `/account` for someone in no workspace, or only a Tester
 * in it, who has no Settings.
 */
export function accountWorkspace(me: Me): string | null {
  const home = homeWorkspace(me);
  if (!home || isOnlyTester(me, home.workspace.id)) return null;
  return home.workspace.slug;
}
