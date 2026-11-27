import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { updateWorkspaceRequestSchema, workspaceSchema, type Me } from '@turnkeel/protocol';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Field, FormError } from '@/components/form';
import { PageHeader } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useWorkspace } from '@/features/session/session';
import { api, seg } from '@/lib/api';
import { fieldErrors, refusal } from '@/lib/form-errors';
import { keys, serverQuery } from '@/lib/queries';
import { messages } from '@/messages';
import { UnverifiedSignInNote } from './unverified-sign-in';

type SettingsField = 'name' | 'slug';

/** The workspace's name and address, under `workspace.update` (Owner and Admin). */
export function WorkspaceSettingsPage() {
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const current = workspace.entry.workspace;
  // Read by the layout before any page of the app shows, so it is there.
  const server = useSuspenseQuery(serverQuery).data;
  const mayEdit = workspace.abilities.updateWorkspace;

  const [name, setName] = useState(current.name);
  const [slug, setSlug] = useState(current.slug);
  const [errors, setErrors] = useState<Partial<Record<SettingsField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: { name?: string; slug?: string }) =>
      api('PATCH', `/workspaces/${seg(workspace.slug)}`, workspaceSchema, { body }),
    onSuccess: async (updated) => {
      // The header and the address follow at once; what the server holds is read after.
      queryClient.setQueryData<Me | null>(keys.me, (me) =>
        me
          ? {
              ...me,
              workspaces: me.workspaces.map((entry) =>
                entry.workspace.id === updated.id ? { ...entry, workspace: updated } : entry,
              ),
            }
          : me,
      );
      toast.success(messages.common.saved);
      // The address is part of every link, so the page moves with it.
      if (updated.slug !== workspace.slug) {
        await navigate({
          to: '/w/$ws/settings/workspace',
          params: { ws: updated.slug },
          replace: true,
        });
      }
      void queryClient.invalidateQueries({ queryKey: keys.me });
    },
    onError: (error) => {
      const { field, message } = refusal(error);
      if (field === 'slug') setErrors({ slug: message });
      else setFormError(message);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const parsed = updateWorkspaceRequestSchema.safeParse({ name, slug: slug.trim() });
    if (!parsed.success) {
      setErrors(
        fieldErrors<SettingsField>(
          parsed.error,
          { name: messages.validation.nameLength, slug: messages.validation.slug },
          messages.validation.required,
        ),
      );
      return;
    }
    setErrors({});
    const patch = {
      ...(parsed.data.name !== current.name ? { name: parsed.data.name } : {}),
      ...(parsed.data.slug !== current.slug ? { slug: parsed.data.slug } : {}),
    };
    // Save stays pressable when nothing has changed, as on a project's page, and then
    // writes nothing.
    if (Object.keys(patch).length === 0) {
      toast.success(messages.common.saved);
      return;
    }
    save.mutate(patch);
  };

  return (
    <section>
      <PageHeader
        title={messages.settings.workspaceTitle}
        intro={messages.settings.workspaceIntro}
      />
      <form onSubmit={submit} className="grid max-w-md gap-4" noValidate>
        <Field label={messages.workspace.nameLabel} error={errors.name}>
          {(control) => (
            <Input
              {...control}
              name="name"
              value={name}
              readOnly={!mayEdit}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <Field
          label={messages.workspace.slugLabel}
          hint={mayEdit ? messages.workspace.slugHint : undefined}
          error={errors.slug}
        >
          {(control) => (
            <Input
              {...control}
              name="slug"
              autoCapitalize="none"
              spellCheck={false}
              value={slug}
              readOnly={!mayEdit}
              onChange={(event) => setSlug(event.target.value)}
            />
          )}
        </Field>
        <FormError message={formError} />
        {mayEdit ? (
          <div>
            <Button type="submit" pending={save.isPending}>
              {messages.common.save}
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground">{messages.workspace.readOnly}</p>
        )}
      </form>
      {/* The time zone stays here; the planning switches have a section of their own. */}
      <PlanningSettings part="zone" />
      <UnverifiedSignInNote server={server} />
    </section>
  );
}
