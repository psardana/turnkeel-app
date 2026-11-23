import {
  countSignInAccounts,
  countWorkspaces,
  createUser,
  findUserByEmail,
  membershipsOf,
  type Database,
  type UserRow,
} from '@turnkeel/db';
import { messages } from '../messages.js';

/**
 * The address of the local owner's account. Nobody signs in with it and no mail goes
 * to it; `.invalid` is a name that never resolves. It is how the account is found
 * again at the next start.
 */
export const LOCAL_OWNER_EMAIL = 'owner@turnkeel.invalid';

/**
 * The local owner's account, which local mode without sign-in needs before it serves a
 * request: a row with no way to sign in. Only a request with the local session
 * cookie acts as this person. Made at the first start, found again at every other.
 */
export async function prepareLocalInstall(db: Database): Promise<UserRow> {
  return (
    (await findUserByEmail(db, LOCAL_OWNER_EMAIL)) ??
    (await createUser(db, {
      name: messages.local.ownerName,
      email: LOCAL_OWNER_EMAIL,
      emailVerified: false,
    }))
  );
}

/**
 * A first run: the database has no workspace at all, a deleted one included.
 * Only then can local mode load the demo: with `turnkeel --demo`, or when the first page
 * asks for it ("Look at the demo first"). Otherwise the app asks the local owner the one
 * question and makes their workspace and first project.
 */
export async function isFirstRun(db: Database): Promise<boolean> {
  return (await countWorkspaces(db, { includeDeleted: true })) === 0;
}

/**
 * True for a database that local mode made and that nobody could sign in to: the
 * local owner holds its workspaces, and it has no account with a way to sign in.
 *
 * A server with sign-in must not start on such a database. The first person to sign
 * in would get an account that holds nothing, could create no workspace because one
 * exists, and nobody could invite them, since the only Owner cannot sign in. To move a
 * local install to a server with sign-in, `turnkeel owner claim` first gives the local
 * owner an address to sign in with (`owner/claim.ts`).
 *
 * A database with people in it stays usable when it was once started in local mode
 * by mistake: the local owner's account is then there, holds nothing, and is in
 * nobody's way.
 */
export async function isLocalOnlyInstall(db: Database): Promise<boolean> {
  const owner = await findUserByEmail(db, LOCAL_OWNER_EMAIL);
  if (owner === null) return false;
  if ((await membershipsOf(db, owner.id)).length === 0) return false;
  return (await countSignInAccounts(db)) === 0;
}
