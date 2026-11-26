import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createInvitationRequestSchema,
  createInvitationResponseSchema,
  type Project,
  type Role,
} from '@turnkeel/protocol';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { useSession, useWorkspace } from '@/features/session/session';
import { api, errorMessage, seg } from '@/lib/api';
import { rolesToInvite } from '@/lib/permissions';
import { keys } from '@/lib/queries';
import { useReturnFocus } from '@/lib/return-focus';
import { messages } from '@/messages';

/**
 * Invites a person by email, with a role and, when wanted, for one project only
 * The roles on offer are the ones this person may give.
 */
export function InviteDialog({
  open,
  onOpenChange,
  projects,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: readonly Project[];
}) {
  const workspace = useWorkspace();
  const { me, server } = useSession();
  const queryClient = useQueryClient();
  const workspaceId = workspace.entry.workspace.id;

  const [email, setEmail] = useState('');
  const [projectId, setProjectId] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [emailError, setEmailError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);

  const focus = useReturnFocus();
  const roles = rolesToInvite(me, workspaceId, projectId === '' ? null : projectId);
  const chosenRole = roles.includes(role) ? role : (roles[0] ?? 'member');

  const invite = useMutation({
    mutationFn: (body: unknown) =>
      api(
        'POST',
        `/workspaces/${seg(workspace.slug)}/invitations`,
        createInvitationResponseSchema,
        { body },
      ),
    onSuccess: async ({ invitation, mail }) => {
      await queryClient.invalidateQueries({ queryKey: keys.invitations(workspace.slug) });
      if (mail === 'sent') toast.success(messages.members.mailSent(invitation.email));
      else if (mail === 'logged') toast.info(messages.members.mailLogged(invitation.email));
      else toast.warning(messages.members.mailFailed(invitation.email));
      setEmail('');
      onOpenChange(false);
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const parsed = createInvitationRequestSchema.safeParse({
      email: email.trim(),
      role: chosenRole,
      ...(projectId === '' ? {} : { projectId }),
    });
    if (!parsed.success) {
      setEmailError(messages.validation.email);
      return;
    }
    setEmailError(undefined);
    invite.mutate(parsed.data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" {...focus}>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{messages.members.inviteTitle}</DialogTitle>
            <DialogDescription>{messages.members.inviteIntro}</DialogDescription>
          </DialogHeader>
          <Field label={messages.members.emailLabel} error={emailError}>
            {(control) => (
              <Input
                {...control}
                type="email"
                name="email"
                inputMode="email"
                autoComplete="off"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            )}
          </Field>
          <Field label={messages.members.scopeLabel}>
            {(control) => (
              <NativeSelect
                {...control}
                name="projectId"
                className="w-full"
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
              >
                <NativeSelectOption value="">{messages.members.wholeWorkspace}</NativeSelectOption>
                {projects.map((project) => (
                  <NativeSelectOption key={project.id} value={project.id}>
                    {messages.members.scopeProject(project.name)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label={messages.members.roleFieldLabel} hint={messages.roles.note(chosenRole)}>
            {(control) => (
              <NativeSelect
                {...control}
                name="role"
                className="w-full"
                value={chosenRole}
                onChange={(event) => setRole(event.target.value as Role)}
              >
                {roles.map((option) => (
                  <NativeSelectOption key={option} value={option}>
                    {messages.roles.name(option)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </Field>
          {server.mail === 'log' ? <Notice>{messages.members.mailNotConfigured}</Notice> : null}
          <FormError message={formError} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {messages.common.cancel}
            </Button>
            <Button type="submit" pending={invite.isPending}>
              {messages.members.send}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
