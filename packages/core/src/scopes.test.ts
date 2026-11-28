import { agentScopes, filePurposes, type AgentScope, type FilePurpose } from '@turnkeel/protocol';
import { describe, expect, it } from 'vitest';
import {
  anyReadScopeActions,
  fileReadActions,
  humanOnlyActions,
  noScopeReads,
  scopeTable,
  uploadScopes,
  type TableAction,
} from './index.js';

/**
 * The scope tables, written out again by hand and not read from `scopes.ts` or
 * `actions.ts`, so that the two are held against each other, as `matrix.test.ts` does
 * for the role table.
 */

/** The table "Scope | Allows". `file.upload` is in the rows whose text names an upload. */
const specScopes: Record<AgentScope, readonly TableAction[]> = {
  'cards:read': ['card.read'],
  'cards:write': ['card.create', 'card.update', 'card.move', 'card.status.add', 'epic.propose'],
  'planning:write': ['milestone.write', 'label.write'],
  'epics:write': ['epic.write'],
  'testing:read': ['build.read', 'step.notes.read', 'feedback.read'],
  'testing:post': ['build.post', 'file.upload'],
  'testing:reply': ['step.reply'],
  'assets:read': ['asset.read'],
  'assets:propose': ['asset.propose', 'file.upload'],
  'posts:read': ['post.read'],
  'posts:write': ['post.write'],
  'gates:read': ['gate.read', 'listing.read'],
  'gates:check': ['gate.check', 'file.upload'],
  'gates:sync': ['gate.sync', 'listing.sync', 'file.upload'],
  'decisions:read': ['decision.read'],
  'decisions:propose': ['decision.propose'],
  'decisions:decide': ['decision.relay'],
  'releases:read': ['release.read'],
  'releases:write': ['release.write'],
  'inbox:read': ['inbox.read'],
  'inbox:write': ['inbox.write'],
  'signals:write': ['signal.write'],
  'money:read': ['money.read'],
  'docs:read': ['doc.read'],
  'docs:sync': ['doc.sync', 'file.upload'],
  'links:write': ['link.add', 'link_group.read'],
  'sessions:write': ['session.write'],
  'routines:run': ['routine.run'],
  'cards:archive': ['card.archive'],
  'inbox:triage': ['inbox.triage'],
  'testing:mark': ['step.mark', 'step.note'],
  'money:write': ['money.write', 'file.upload', 'receipt.suggest'],
  'assets:decide': ['asset.decide', 'asset.note'],
  'posts:approve': ['post.approve', 'post.skip'],
  'gates:pass': ['gate.pass', 'gate.confirm_change', 'listing.mark'],
  'releases:publish': ['release.publish'],
  'posts:send': ['post.send'],
  'spend:commit': ['spend.commit'],
};

/** "Files": which scope goes with each purpose of an upload. Null: no scope, so no token uploads it. */
const specUploadScopes: Record<FilePurpose, AgentScope | null> = {
  step_run: 'testing:post',
  asset_variant: 'assets:propose',
  gate_evidence: 'gates:check',
  listing_file: 'gates:sync',
  doc_image: 'docs:sync',
  post_media: null,
  receipt: 'money:write',
};

/**
 * R46 with 3.9: the read action of the item each purpose attaches a file to. A step's
 * run is a build's, a variant an asset's, evidence a gate's, a doc image a doc's, a
 * listing file a listing's, post media a post's, and a receipt a cost line's (money).
 */
const specFileReads: Record<FilePurpose, TableAction> = {
  step_run: 'build.read',
  asset_variant: 'asset.read',
  gate_evidence: 'gate.read',
  listing_file: 'listing.read',
  doc_image: 'doc.read',
  post_media: 'post.read',
  receipt: 'money.read',
};

/** "Human-only actions", in the order of the specification, with `project.*` and `workspace.*` written out. */
const specHumanOnly: readonly TableAction[] = [
  'assistant.draft',
  'assistant.manage',
  'asset.archive',
  'asset_group.write',
  'build.archive',
  'build.testers',
  'decision.decide',
  'link.write',
  'session.dismiss',
  'project.create',
  'project.update',
  'project.archive',
  'member.read',
  'member.manage',
  'agent.read',
  'agent.manage',
  'connector.read',
  'connector.manage',
  'events.read',
  'events.export',
  'workspace.update',
  'workspace.delete',
  'workspace.transfer',
  'planning.remove',
  'recurrence.write',
  'time.write',
  'time.manage',
  'view.share',
  'epic.accept',
  'routine.manage',
];

const sorted = <T extends string>(values: readonly T[]) => [...values].sort();

describe('the scope tables, written out by hand', () => {
  it('has a row for every scope of the protocol, and no other', () => {
    expect(sorted(Object.keys(specScopes))).toEqual(sorted(agentScopes));
    expect(sorted(Object.keys(scopeTable))).toEqual(sorted(agentScopes));
  });

  it.each(agentScopes)('%s allows what the specification says, and nothing more', (scope) => {
    expect(sorted(scopeTable[scope])).toEqual(sorted(specScopes[scope]));
  });

  it.each(filePurposes)(
    'an upload for %s goes with the scope the specification names',
    (purpose) => {
      expect(uploadScopes[purpose]).toBe(specUploadScopes[purpose]);
    },
  );

  it('every scope that allows file.upload goes with exactly one purpose, and the others with none', () => {
    for (const scope of agentScopes) {
      const purposes = filePurposes.filter((purpose) => uploadScopes[purpose] === scope);
      expect(purposes.length, scope).toBe(scopeTable[scope].includes('file.upload') ? 1 : 0);
    }
  });

  it.each(filePurposes)('a file for %s is read through the read action of its item', (purpose) => {
    expect(fileReadActions[purpose]).toBe(specFileReads[purpose]);
  });

  it('has the human-only list of the specification, in its order', () => {
    expect([...humanOnlyActions]).toEqual(specHumanOnly);
  });

  it('gives people.read and file.read with any read scope, and no scope reads links, sessions, time (R76) or routines (R84)', () => {
    expect(sorted(anyReadScopeActions)).toEqual(['file.read', 'people.read']);
    expect(sorted(noScopeReads)).toEqual([
      'link.read',
      'routine.read',
      'session.read',
      'time.read',
    ]);
  });
});
