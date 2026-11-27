import { allow, forbid, hide, type Decision } from './decision.js';
import { messages } from './messages.js';

/** What decides whether a sign-in may create an account. */
export interface AccountCreation {
  /** How many accounts the server has that someone can sign in to (`canSignInWith`). */
  readonly accountCount: number;
  /** `TURNKEEL_OPEN_SIGNUP=true`. */
  readonly openSignup: boolean;
  /** True when an invitation to this email address is open: not accepted, not revoked, not expired. */
  readonly hasOpenInvitation: boolean;
}

/**
 * R44: an account is created in one of three ways only: by the first sign-in on an
 * install that has no accounts, by accepting an invitation, or by signing up when open
 * sign-up is on.
 */
export function canCreateAccount(facts: AccountCreation): Decision {
  if (facts.accountCount === 0 || facts.openSignup || facts.hasOpenInvitation) return allow;
  return forbid(messages.accountByInvitation, 'R44');
}

/**
 * Whether anyone can sign in with this address. An address under `.invalid` never
 * resolves and gets no mail, and the accounts the server makes for itself use one:
 * the local owner of local mode, and the people the demo seeds. Such an account is
 * not one of the accounts R44 counts, and no sign-in link is ever made for it.
 */
export function canSignInWith(email: string): boolean {
  return !email.trim().toLowerCase().endsWith(NO_SIGN_IN_SUFFIX);
}

/** The end of an address that nobody can sign in with. */
export const NO_SIGN_IN_SUFFIX = '.invalid';

/** What decides whether an invitation can be accepted. */
export interface InvitationAcceptance {
  readonly invitation: {
    readonly email: string;
    readonly expiresAt: Date;
    readonly acceptedAt: Date | null;
    readonly revokedAt: Date | null;
  };
  /** The signed-in person. */
  readonly user: { readonly email: string; readonly emailVerified: boolean };
  /** The server's time. */
  readonly now: Date;
}

/**
 * R45: an invitation can be accepted once, before it expires and while it is not
 * revoked, and only by a signed-in person whose verified email address is the one
 * invited, without regard to case. A used, expired or revoked invitation gets the same
 * `not_found` as a token nobody knows.
 */
export function canAcceptInvitation({ invitation, user, now }: InvitationAcceptance): Decision {
  if (invitation.acceptedAt !== null || invitation.revokedAt !== null) return hide45();
  if (invitation.expiresAt.getTime() <= now.getTime()) return hide45();
  if (invitation.email.trim().toLowerCase() !== user.email.trim().toLowerCase()) {
    return forbid(messages.invitationOtherAddress, 'R45');
  }
  if (!user.emailVerified) return forbid(messages.invitationUnverified, 'R45');
  return allow;
}

function hide45(): Decision {
  return { ...hide(), rule: 'R45' };
}

/** How long an invitation can be accepted. */
export const INVITATION_DAYS = 7;

/** When an invitation made at `from` expires. */
export function invitationExpiry(from: Date): Date {
  return new Date(from.getTime() + INVITATION_DAYS * 24 * 60 * 60 * 1000);
}
