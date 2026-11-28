import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Invitation,
  Member,
  Project,
  WorkspacePerson,
  WorkspaceRole,
} from '@turnkeel/protocol';
import { invitationSchema, memberSchema } from '@turnkeel/protocol';
import { UserPlusIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Notice } from '@/components/form';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { useSession, useWorkspace } from '@/features/session/session';
import { api, apiVoid, errorMessage, seg } from '@/lib/api';
import { formatDateTime } from '@/lib/dates';
import {
  canRemoveMember,
  canRevokeInvitation,
  projectRolesToGive,
  rolesToGive,
} from '@/lib/permissions';
import { invitationsQuery, keys, membersQuery, projectsQuery } from '@/lib/queries';
import { toastFailure } from '@/lib/toast';
import { messages } from '@/messages';
import { InviteDialog } from './invite-dialog';
import { ProjectRolesDialog } from './project-roles-dialog';

const nameOf = (person: WorkspacePerson) => person.user.name || person.user.email;

/** An invitation that can still be accepted. */
export const isOpen = (invitation: Invitation, now: Date = new Date()) =>
  invitation.acceptedAt === null &&
  invitation.revokedAt === null &&
  new Date(invitation.expiresAt).getTime() > now.getTime();

function RoleCell({
  person,
  member,
  ownerCount,
}: {
  person: WorkspacePerson;
  member: Member;
  ownerCount: number;
}) {
  const workspace = useWorkspace();
  const { me } = useSession();
  const queryClient = useQueryClient();
  const options = workspace.abilities.manageMembers
    ? rolesToGive(me, workspace.entry.workspace.id, member.role, ownerCount)
    : [member.role];
  const membersKey = keys.members(workspace.slug);

  // The new role shows at once and is put back, with the reason, if the server refuses it.
  const change = useMutation({
    mutationFn: (role: WorkspaceRole) =>
      api(
        'PATCH',
        `/workspaces/${seg(workspace.slug)}/members/${seg(person.user.id)}`,
        memberSchema,
        { body: { role } },
      ),
    onMutate: async (role) => {
      await queryClient.cancelQueries({ queryKey: membersKey });
      const before = queryClient.getQueryData<WorkspacePerson[]>(membersKey);
      queryClient.setQueryData<WorkspacePerson[]>(membersKey, (list) =>
        list?.map((entry) =>
          entry.user.id === person.user.id && entry.member
            ? { ...entry, member: { ...entry.member, role } }
            : entry,
        ),
      );
      return { before };
    },
    onSuccess: (updated) => {
      toast.success(messages.members.roleChanged({ name: nameOf(person), role: updated.role }));
    },
    onError: (error, _role, context) => {
      if (context?.before) queryClient.setQueryData(membersKey, context.before);
      toastFailure(messages.errors.rolledBack(errorMessage(error)));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: membersKey });
      void queryClient.invalidateQueries({ queryKey: keys.me });
    },
  });

  if (options.length <= 1) return <span>{messages.roles.name(member.role)}</span>;
  return (
    <NativeSelect
      aria-label={messages.members.roleLabel(nameOf(person))}
      value={member.role}
      disabled={change.isPending}
      onChange={(event) => change.mutate(event.target.value as WorkspaceRole)}
    >
      {options.map((role) => (
        <NativeSelectOption key={role} value={role}>
          {messages.roles.name(role)}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

function MemberList({ people, projects }: { people: WorkspacePerson[]; projects: Project[] }) {
  const workspace = useWorkspace();
  const { me } = useSession();
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState<WorkspacePerson | null>(null);
  const [assigning, setAssigning] = useState<WorkspacePerson | null>(null);
  const ownerCount = people.filter((person) => person.member?.role === 'owner').length;
  const projectName = (id: string) =>
    projects.find((project) => project.id === id)?.name ?? messages.activity.theProject;

  const remove = useMutation({
    mutationFn: (person: WorkspacePerson) =>
      apiVoid('DELETE', `/workspaces/${seg(workspace.slug)}/members/${seg(person.user.id)}`),
    onSuccess: async (_nothing, person) => {
      setRemoving(null);
      toast.success(messages.members.removed(nameOf(person)));
      await queryClient.invalidateQueries({ queryKey: keys.members(workspace.slug) });
    },
    onError: (error) => {
      setRemoving(null);
      toastFailure(errorMessage(error));
    },
  });

  return (
    <>
      <ul className="border-t">
        {people.map((person) => {
          const isMe = person.user.id === me.user.id;
          const mayRemove =
            workspace.abilities.manageMembers &&
            !isMe &&
            canRemoveMember(
              me,
              workspace.entry.workspace.id,
              person.member?.role ?? null,
              ownerCount,
            );
          // R2: a project role for someone already in the workspace. Not one's own, and
          // an Owner's only for an Owner. The limits are the same in every project.
          const firstProject = projects[0];
          const mayAssign =
            workspace.abilities.manageMembers &&
            !isMe &&
            firstProject !== undefined &&
            projectRolesToGive(me, workspace.entry.workspace.id, firstProject.id, {
              userId: person.user.id,
              role: person.member?.role ?? null,
            }).length > 0;
          return (
            <li
              key={person.user.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-b py-2.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_9rem_auto]"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {nameOf(person)}
                  {isMe ? (
                    <span className="font-normal text-muted-foreground">
                      {' '}
                      ({messages.common.you})
                    </span>
                  ) : null}
                </p>
                {person.user.name ? (
                  <p className="truncate text-meta text-muted-foreground">{person.user.email}</p>
                ) : null}
              </div>
              <p className="truncate font-mono text-meta text-muted-foreground max-sm:col-start-1">
                {person.member ? `@${person.member.handle}` : messages.members.noHandle}
              </p>
              <div className="max-sm:col-start-1">
                {person.member ? (
                  <RoleCell person={person} member={person.member} ownerCount={ownerCount} />
                ) : (
                  <span className="text-muted-foreground">{messages.roles.projectOnly}</span>
                )}
              </div>
              <div className="flex flex-wrap justify-end gap-2 max-sm:col-start-2 max-sm:row-span-3 max-sm:row-start-1">
                {mayAssign ? (
                  <Button
                    variant="outline"
                    aria-label={messages.members.projectRolesLabel(nameOf(person))}
                    onClick={() => setAssigning(person)}
                  >
                    {messages.members.projectRoles}
                  </Button>
                ) : null}
                {mayRemove ? (
                  <Button
                    variant="outline"
                    aria-label={messages.members.removeLabel(nameOf(person))}
                    onClick={() => setRemoving(person)}
                  >
                    {messages.members.remove}
                  </Button>
                ) : null}
              </div>
              {person.projectMembers.length > 0 ? (
                <ul className="col-span-full flex flex-wrap gap-1.5">
                  {person.projectMembers.map((projectMember) => (
                    <li key={projectMember.id}>
                      <Badge variant="neutral">
                        {messages.members.projectRole({
                          project: projectName(projectMember.projectId),
                          role: projectMember.role,
                        })}
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
      {assigning ? (
        <ProjectRolesDialog
          key={assigning.user.id}
          person={assigning}
          name={nameOf(assigning)}
          projects={projects}
          onOpenChange={(open) => {
            if (!open) setAssigning(null);
          }}
        />
      ) : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={removing ? messages.members.removeTitle(nameOf(removing)) : ''}
        confirmLabel={messages.members.remove}
        pending={remove.isPending}
        onConfirm={() => {
          if (removing) remove.mutate(removing);
        }}
      >
        {messages.members.removeBody}
      </ConfirmDialog>
    </>
  );
}

function PendingInvitations({ projects }: { projects: Project[] }) {
  const workspace = useWorkspace();
  const { me } = useSession();
  const queryClient = useQueryClient();
  const invitations = useQuery(invitationsQuery(workspace.slug));
  const [revoking, setRevoking] = useState<Invitation | null>(null);

  const revoke = useMutation({
    mutationFn: (invitation: Invitation) =>
      api('DELETE', `/invitations/${seg(invitation.id)}`, invitationSchema),
    onSuccess: async (revoked) => {
      setRevoking(null);
      toast.success(messages.members.revoked(revoked.email));
      await queryClient.invalidateQueries({ queryKey: keys.invitations(workspace.slug) });
    },
    onError: (error) => {
      setRevoking(null);
      toastFailure(errorMessage(error));
    },
  });

  const open = (invitations.data ?? []).filter((invitation) => isOpen(invitation));

  return (
    <section aria-labelledby="pending-invitations" className="mt-8">
      <h2 id="pending-invitations" className="mb-3 text-body font-semibold">
        {messages.members.pendingTitle}
      </h2>
      {invitations.isPending ? (
        <LoadingState />
      ) : invitations.isError ? (
        <ErrorState
          what={messages.members.pendingWhat}
          error={invitations.error}
          onRetry={() => void invitations.refetch()}
        />
      ) : open.length === 0 ? (
        <p className="text-muted-foreground">{messages.members.pendingEmpty}</p>
      ) : (
        <ul className="border-t">
          {open.map((invitation) => {
            const project = projects.find((candidate) => candidate.id === invitation.projectId);
            return (
              <li
                key={invitation.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b py-2.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_5.5rem]"
              >
                <p className="truncate font-medium">{invitation.email}</p>
                <p className="text-muted-foreground max-sm:col-start-1">
                  {messages.roles.name(invitation.role)}
                  {' · '}
                  {messages.members.pendingScope(
                    invitation.projectId === null
                      ? null
                      : (project?.name ?? messages.activity.theProject),
                  )}
                </p>
                <p className="text-meta text-muted-foreground max-sm:col-start-1">
                  {messages.members.pendingColumns.expires}{' '}
                  <time dateTime={invitation.expiresAt}>
                    {formatDateTime(invitation.expiresAt)}
                  </time>
                </p>
                <div className="flex justify-end max-sm:col-start-2 max-sm:row-span-3 max-sm:row-start-1">
                  {canRevokeInvitation(me, workspace.entry.workspace.id, invitation.role) ? (
                    <Button
                      variant="outline"
                      aria-label={messages.members.revokeLabel(invitation.email)}
                      onClick={() => setRevoking(invitation)}
                    >
                      {messages.members.revoke}
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(next) => {
          if (!next) setRevoking(null);
        }}
        title={revoking ? messages.members.revokeTitle(revoking.email) : ''}
        confirmLabel={messages.members.revoke}
        pending={revoke.isPending}
        onConfirm={() => {
          if (revoking) revoke.mutate(revoking);
        }}
      >
        {messages.members.revokeBody}
      </ConfirmDialog>
    </section>
  );
}

/**
 * Members and invitations, for a person with `member.read` (Owner and Admin). What
 * can be changed is what `member.manage` allows, with the limits of R9, R31 and R32.
 */
export function MembersPage() {
  const workspace = useWorkspace();
  const { server } = useSession();
  const mayRead = workspace.abilities.readMembers;
  const mayManage = workspace.abilities.manageMembers;
  const members = useQuery({ ...membersQuery(workspace.slug), enabled: mayRead });
  const projects = useQuery({ ...projectsQuery(workspace.slug), enabled: mayRead });
  const [inviting, setInviting] = useState(false);
  const local = server.mode === 'local';

  if (!mayRead) {
    return (
      <section>
        <PageHeader title={messages.members.title} />
        <EmptyState title={messages.errors.forbiddenTitle}>
          {messages.workspace.readOnly}
        </EmptyState>
      </section>
    );
  }

  return (
    <section>
      <PageHeader
        title={messages.members.title}
        intro={messages.members.intro}
        actions={
          mayManage && !local ? (
            <Button onClick={() => setInviting(true)}>
              <UserPlusIcon aria-hidden="true" />
              {messages.members.invite}
            </Button>
          ) : null
        }
      />
      {local ? <Notice className="mb-6">{messages.members.localMode}</Notice> : null}
      {members.isPending ? (
        <LoadingState />
      ) : members.isError ? (
        <ErrorState
          what={messages.members.what}
          error={members.error}
          onRetry={() => void members.refetch()}
        />
      ) : members.data.length === 0 ? (
        <EmptyState title={messages.members.onlyYou} />
      ) : (
        <MemberList people={members.data} projects={projects.data ?? []} />
      )}
      {mayManage && !local ? <PendingInvitations projects={projects.data ?? []} /> : null}
      {mayManage && !local ? (
        <InviteDialog open={inviting} onOpenChange={setInviting} projects={projects.data ?? []} />
      ) : null}
    </section>
  );
}
