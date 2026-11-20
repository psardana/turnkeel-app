import { describe, expect, it } from 'vitest';
import {
  INVITATION_DAYS,
  canAcceptInvitation,
  canCreateAccount,
  canSignInWith,
  invitationExpiry,
} from './index.js';

describe('how an account is created', () => {
  it('the first sign-in on an install with no accounts creates one', () => {
    expect(
      canCreateAccount({ accountCount: 0, openSignup: false, hasOpenInvitation: false }).allowed,
    ).toBe(true);
  });

  it('accepting an invitation creates one', () => {
    expect(
      canCreateAccount({ accountCount: 3, openSignup: false, hasOpenInvitation: true }).allowed,
    ).toBe(true);
  });

  it('open sign-up creates one', () => {
    expect(
      canCreateAccount({ accountCount: 3, openSignup: true, hasOpenInvitation: false }).allowed,
    ).toBe(true);
  });

  it('nothing else does', () => {
    expect(
      canCreateAccount({ accountCount: 1, openSignup: false, hasOpenInvitation: false }),
    ).toEqual({
      allowed: false,
      kind: 'forbidden',
      reason: 'This server takes new accounts by invitation only.',
      rule: 'R44',
    });
  });
});

describe('the accounts nobody can sign in to', () => {
  it('an address under .invalid cannot sign in, whatever its case', () => {
    expect(canSignInWith('owner@turnkeel.invalid')).toBe(false);
    expect(canSignInWith(' Demo.Person@Example.INVALID ')).toBe(false);
  });

  it('any other address can', () => {
    expect(canSignInWith('olive@example.com')).toBe(true);
    expect(canSignInWith('invalid@example.com')).toBe(true);
    expect(canSignInWith('olive@invalid.example')).toBe(true);
  });
});

describe('accepting an invitation', () => {
  const now = new Date('2026-11-11T12:00:00.000Z');
  const invitation = {
    email: 'ana@example.com',
    expiresAt: new Date('2026-11-18T12:00:00.000Z'),
    acceptedAt: null,
    revokedAt: null,
  };
  const user = { email: 'ana@example.com', emailVerified: true };

  it('the invited person accepts before it expires', () => {
    expect(canAcceptInvitation({ invitation, user, now })).toEqual({ allowed: true });
  });

  it('the email address is compared without regard to case', () => {
    expect(
      canAcceptInvitation({ invitation, user: { ...user, email: ' Ana@Example.COM ' }, now })
        .allowed,
    ).toBe(true);
  });

  it('an invitation works once', () => {
    expect(
      canAcceptInvitation({ invitation: { ...invitation, acceptedAt: now }, user, now }),
    ).toMatchObject({ allowed: false, kind: 'not_found', rule: 'R45' });
  });

  it('a revoked invitation is not found', () => {
    expect(
      canAcceptInvitation({ invitation: { ...invitation, revokedAt: now }, user, now }),
    ).toMatchObject({ allowed: false, kind: 'not_found', rule: 'R45' });
  });

  it('an expired invitation is not found, from the moment it expires', () => {
    expect(canAcceptInvitation({ invitation, user, now: invitation.expiresAt })).toMatchObject({
      allowed: false,
      kind: 'not_found',
      rule: 'R45',
    });
    expect(
      canAcceptInvitation({ invitation, user, now: new Date(invitation.expiresAt.getTime() - 1) })
        .allowed,
    ).toBe(true);
  });

  it('used, revoked and expired give the same answer', () => {
    const used = canAcceptInvitation({ invitation: { ...invitation, acceptedAt: now }, user, now });
    const revoked = canAcceptInvitation({
      invitation: { ...invitation, revokedAt: now },
      user,
      now,
    });
    const expired = canAcceptInvitation({
      invitation,
      user,
      now: new Date('2027-01-01T00:00:00Z'),
    });
    expect(revoked).toEqual(used);
    expect(expired).toEqual(used);
  });

  it('another email address cannot accept it', () => {
    expect(
      canAcceptInvitation({ invitation, user: { ...user, email: 'ben@example.com' }, now }),
    ).toMatchObject({ allowed: false, kind: 'forbidden', rule: 'R45' });
  });

  it('an address that is not verified cannot accept it', () => {
    expect(
      canAcceptInvitation({ invitation, user: { ...user, emailVerified: false }, now }),
    ).toMatchObject({ allowed: false, kind: 'forbidden', rule: 'R45' });
  });

  it('expires after 7 days', () => {
    expect(INVITATION_DAYS).toBe(7);
    expect(invitationExpiry(now).toISOString()).toBe('2026-11-18T12:00:00.000Z');
  });
});
