import type { Principal } from '@turnkeel/core';
import type { Actor, EventVia, User } from '@turnkeel/protocol';

/**
 * Who makes a request: the principal the permission check judges, and what the
 * events of the request say about it.
 */
export interface Caller {
  readonly principal: Principal;
  /** The actor of every event this request appends. */
  readonly actor: Actor;
  /** The channel: `web` for a person's session, `cli` or `rest` for a bearer call. */
  readonly via: EventVia;
  /** The token an agent used. Null for a person. */
  readonly tokenId: string | null;
  /** The person's account. Null for an agent. */
  readonly user: User | null;
}

/** What every handler finds on the Hono context. */
export interface AppEnv {
  Variables: {
    /** The id of this request, also sent as `X-Request-Id`. Every event of the request
     * carries it. */
    requestId: string;
    /** Set by the principal middleware on the routes that need one. */
    caller: Caller;
  };
}
