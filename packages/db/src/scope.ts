import { MissingScopeError } from './errors.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The workspace a repository works in. Every table carries `workspace_id`, and a
 * repository puts the scope's id into every query it runs, so a query cannot reach
 * another workspace's rows.
 */
export interface WorkspaceScope {
  readonly workspaceId: string;
}

/** Makes a scope. Throws when `workspaceId` is not a UUID. */
export function workspaceScope(workspaceId: string): WorkspaceScope {
  const scope = { workspaceId };
  assertScope(scope);
  return Object.freeze({ workspaceId: scope.workspaceId.toLowerCase() });
}

/** Throws `MissingScopeError` unless `scope` names a workspace. */
export function assertScope(scope: unknown): asserts scope is WorkspaceScope {
  if (
    typeof scope !== 'object' ||
    scope === null ||
    typeof (scope as { workspaceId?: unknown }).workspaceId !== 'string' ||
    !uuidPattern.test((scope as WorkspaceScope).workspaceId)
  ) {
    throw new MissingScopeError();
  }
}
