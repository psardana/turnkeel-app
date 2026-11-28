import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  projectMemberSchema,
  type Project,
  type ProjectRole,
  type WorkspacePerson,
} from '@turnkeel/protocol';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Field, FormError } from '@/components/form';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { useSession, useWorkspace } from '@/features/session/session';
import { api, apiVoid, errorMessage, seg } from '@/lib/api';
import { projectRolesToGive } from '@/lib/permissions';
import { keys } from '@/lib/queries';
import { useReturnFocus } from '@/lib/return-focus';
import { messages } from '@/messages';

const NONE = 'none';

/**
 * Gives a person who is already in the workspace a role in one project, changes it,
 * or takes it away (`PUT` and `DELETE .../projects/:p/members/:userId`). A
 * project role replaces the workspace role in that project, and an Owner stays Owner
 * The roles on offer are the ones this person may give.
 */
export function ProjectRolesDialog({
  person,
  name,
  projects,
  onOpenChange,
}: {
  person: WorkspacePerson | null;
  name: string;
  projects: readonly Project[];
  onOpenChange: (open: boolean) => void;
}) {
  const workspace = useWorkspace();
  const { me } = useSession();
  const queryClient = useQueryClient();
  const focus = useReturnFocus();
  const workspaceId = workspace.entry.workspace.id;

  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const held = (id: string): ProjectRole | typeof NONE =>
    person?.projectMembers.find((entry) => entry.projectId === id)?.role ?? NONE;
  const [role, setRole] = useState<ProjectRole | typeof NONE>(held(projectId));
  const [formError, setFormError] = useState<string | null>(null);

  const project = projects.find((candidate) => candidate.id === projectId);
  const roles =
    projectId === '' || !person
      ? []
      : projectRolesToGive(me, workspaceId, projectId, {
          userId: person.user.id,
          role: person.member?.role ?? null,
        });

  const save = useMutation({
    mutationFn: async () => {
      if (!person || !project) return;
      const path = `/workspaces/${seg(workspace.slug)}/projects/${seg(project.key)}/members/${seg(person.user.id)}`;
      if (role === NONE) await apiVoid('DELETE', path);
      else await api('PUT', path, projectMemberSchema, { body: { role } });
    },
    onSuccess: async () => {
      if (project) {
        toast.success(
          role === NONE
            ? messages.members.projectRoleRemoved({ name, project: project.name })
            : messages.members.projectRoleSaved({ name, project: project.name, role }),
        );
      }
      await queryClient.invalidateQueries({ queryKey: keys.members(workspace.slug) });
      await queryClient.invalidateQueries({ queryKey: keys.me });
      onOpenChange(false);
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (role === held(projectId)) {
      onOpenChange(false);
      return;
    }
    save.mutate();
  };

  return (
    <Dialog open={person !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" {...focus}>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{messages.members.projectRolesTitle(name)}</DialogTitle>
            <DialogDescription>{messages.members.projectRolesIntro}</DialogDescription>
          </DialogHeader>
          <Field label={messages.members.projectField}>
            {(control) => (
              <NativeSelect
                {...control}
                name="projectId"
                className="w-full"
                value={projectId}
                onChange={(event) => {
                  setProjectId(event.target.value);
                  setRole(held(event.target.value));
                }}
              >
                {projects.map((option) => (
                  <NativeSelectOption key={option.id} value={option.id}>
                    {option.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field
            label={messages.members.projectRoleField}
            hint={role === NONE ? messages.members.noProjectRoleNote : messages.roles.note(role)}
          >
            {(control) => (
              <NativeSelect
                {...control}
                name="role"
                className="w-full"
                value={role}
                onChange={(event) => setRole(event.target.value as ProjectRole | typeof NONE)}
              >
                <NativeSelectOption value={NONE}>
                  {messages.members.noProjectRole}
                </NativeSelectOption>
                {roles.map((option) => (
                  <NativeSelectOption key={option} value={option}>
                    {messages.roles.name(option)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </Field>
          <FormError message={formError} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {messages.common.cancel}
            </Button>
            <Button type="submit" pending={save.isPending} disabled={projectId === ''}>
              {messages.common.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
