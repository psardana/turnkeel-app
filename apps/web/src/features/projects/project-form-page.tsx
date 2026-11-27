import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import {
  createProjectRequestSchema,
  projectKinds,
  projectSchema,
  type Project,
  type ProjectKind,
} from '@turnkeel/protocol';
import { ArrowLeftIcon } from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Field, FormError, Notice } from '@/components/form';
import { NotFound } from '@/components/route-states';
import { ErrorState, LoadingState, PageHeader } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { useSession, useWorkspace } from '@/features/session/session';
import { api, errorMessage, isNotFound, seg } from '@/lib/api';
import { formatDateTime } from '@/lib/dates';
import { fieldErrors, refusal } from '@/lib/form-errors';
import { canArchiveProject, canUpdateProject } from '@/lib/permissions';
import { keys, projectQuery } from '@/lib/queries';
import { keyFrom, slugFrom } from '@/lib/slug';
import { messages } from '@/messages';

type ProjectField = 'name' | 'key' | 'slug' | 'kind' | 'locales' | 'launchDate';

interface ProjectValues {
  name: string;
  key: string;
  slug: string;
  kind: ProjectKind;
  /** Where an app ships. */
  ships: ShipsChoice;
  locales: string;
  launchDate: string;
}

const sentences: Partial<Record<ProjectField, string>> = {
  name: messages.validation.nameLength,
  key: messages.validation.key,
  slug: messages.validation.slug,
  locales: messages.validation.locales,
  launchDate: messages.validation.date,
};

const splitLocales = (value: string) =>
  value
    .split(',')
    .map((locale) => locale.trim())
    .filter(Boolean);

/** Checks the form with the server's own schema, so both say the same about every field. */
function check(values: ProjectValues) {
  return createProjectRequestSchema.safeParse({
    name: values.name,
    key: values.key.trim(),
    slug: values.slug.trim(),
    kind: values.kind,
    locales: splitLocales(values.locales),
    launchDate: values.launchDate === '' ? null : values.launchDate,
    shipsTo: shipsToOf(values.ships, values.kind),
  });
}

function BackToList() {
  const workspace = useWorkspace();
  return (
    <Link
      to="/w/$ws/settings/projects"
      params={{ ws: workspace.slug }}
      className="mb-3 flex w-fit items-center gap-1 text-muted-foreground hover:text-foreground"
      data-touch
    >
      <ArrowLeftIcon className="size-4" aria-hidden="true" />
      {messages.projects.backToList}
    </Link>
  );
}

function ProjectFields({
  values,
  errors,
  readOnly,
  onChange,
  launchHint,
}: {
  values: ProjectValues;
  errors: Partial<Record<ProjectField, string>>;
  readOnly: boolean;
  onChange: (patch: Partial<ProjectValues>, touched: ProjectField) => void;
  /** While a launch milestone is set: what the date follows, and what clearing it does. */
  launchHint?: string | undefined;
}) {
  return (
    <>
      <Field label={messages.projects.nameLabel} error={errors.name}>
        {(control) => (
          <Input
            {...control}
            name="name"
            value={values.name}
            readOnly={readOnly}
            onChange={(event) => onChange({ name: event.target.value }, 'name')}
          />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={messages.projects.keyLabel}
          hint={messages.projects.keyHint}
          error={errors.key}
        >
          {(control) => (
            <Input
              {...control}
              name="key"
              className="font-mono uppercase"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={6}
              value={values.key}
              readOnly={readOnly}
              onChange={(event) => onChange({ key: event.target.value.toUpperCase() }, 'key')}
            />
          )}
        </Field>
        <Field
          label={messages.projects.slugLabel}
          hint={messages.projects.slugHint}
          error={errors.slug}
        >
          {(control) => (
            <Input
              {...control}
              name="slug"
              autoCapitalize="none"
              spellCheck={false}
              value={values.slug}
              readOnly={readOnly}
              onChange={(event) => onChange({ slug: event.target.value }, 'slug')}
            />
          )}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={messages.projects.kindLabel} error={errors.kind}>
          {(control) => (
            <NativeSelect
              {...control}
              name="kind"
              className="w-full"
              value={values.kind}
              disabled={readOnly}
              onChange={(event) => onChange({ kind: event.target.value as ProjectKind }, 'kind')}
            >
              {projectKinds.map((kind) => (
                <NativeSelectOption key={kind} value={kind}>
                  {messages.projects.kind(kind)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field
          label={messages.projects.launchDateLabel}
          optional
          hint={launchHint}
          error={errors.launchDate}
        >
          {(control) => (
            <Input
              {...control}
              type="date"
              name="launchDate"
              value={values.launchDate}
              readOnly={readOnly}
              onChange={(event) => onChange({ launchDate: event.target.value }, 'launchDate')}
            />
          )}
        </Field>
      </div>
      {values.kind === 'app' ? (
        <ShipsToField
          value={values.ships}
          disabled={readOnly}
          onChange={(ships) => onChange({ ships }, 'kind')}
        />
      ) : null}
      <Field
        label={messages.projects.localesLabel}
        hint={messages.projects.localesHint}
        error={errors.locales}
      >
        {(control) => (
          <Input
            {...control}
            name="locales"
            autoCapitalize="none"
            spellCheck={false}
            value={values.locales}
            readOnly={readOnly}
            onChange={(event) => onChange({ locales: event.target.value }, 'locales')}
          />
        )}
      </Field>
    </>
  );
}

/** A new project: name, key, kind, languages and launch date (`project.create`). */
export function NewProjectPage() {
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [values, setValues] = useState<ProjectValues>({
    name: '',
    key: '',
    slug: '',
    kind: 'app',
    ships: 'unsaid',
    locales: 'en',
    launchDate: '',
  });
  const [touched, setTouched] = useState<Set<ProjectField>>(new Set());
  const [errors, setErrors] = useState<Partial<Record<ProjectField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: unknown) =>
      api('POST', `/workspaces/${seg(workspace.slug)}/projects`, projectSchema, { body }),
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: keys.projects(workspace.slug) });
      toast.success(messages.projects.created(project.name));
      await navigate({ to: '/w/$ws/settings/projects', params: { ws: workspace.slug } });
    },
    onError: (error) => {
      const { field, message } = refusal(error);
      if (field === 'slug' || field === 'key') setErrors({ [field]: message });
      else setFormError(message);
    },
  });

  const change = (patch: Partial<ProjectValues>, field: ProjectField) => {
    setTouched((previous) => new Set(previous).add(field));
    setValues((previous) => {
      const next = { ...previous, ...patch };
      // The key and the address follow the name until the person writes their own.
      if (field === 'name') {
        if (!touched.has('key')) next.key = keyFrom(next.name);
        if (!touched.has('slug')) next.slug = slugFrom(next.name);
      }
      return next;
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const parsed = check(values);
    if (!parsed.success) {
      setErrors(fieldErrors<ProjectField>(parsed.error, sentences, messages.validation.required));
      return;
    }
    setErrors({});
    create.mutate(parsed.data);
  };

  if (!workspace.abilities.createProject) {
    return (
      <section>
        <BackToList />
        <PageHeader title={messages.projects.newTitle} />
        <p className="text-muted-foreground">{messages.projects.readOnly}</p>
      </section>
    );
  }

  return (
    <section>
      <BackToList />
      <PageHeader title={messages.projects.newTitle} intro={messages.projects.intro} />
      <form onSubmit={submit} className="grid max-w-xl gap-4" noValidate>
        <ProjectFields values={values} errors={errors} readOnly={false} onChange={change} />
        <FormError message={formError} />
        <div className="flex gap-2">
          <Button type="submit" pending={create.isPending}>
            {messages.projects.create}
          </Button>
          <Button asChild variant="outline">
            <Link to="/w/$ws/settings/projects" params={{ ws: workspace.slug }}>
              {messages.common.cancel}
            </Link>
          </Button>
        </div>
      </form>
    </section>
  );
}

/**
 * The public changelog switch (`project.update`): what it publishes and where,
 * and that it is off by default. It is saved with the form.
 */
function PublicChangelog({
  on,
  path,
  readOnly,
  onChange,
}: {
  on: boolean;
  path: string;
  readOnly: boolean;
  onChange: (on: boolean) => void;
}) {
  const id = useId();
  const hint = messages.projects.changelogPublicHint(path);
  if (readOnly) {
    return (
      <div className="grid gap-0.5">
        <span className="font-medium">{messages.projects.changelogPublicLabel}</span>
        <span className="text-meta text-muted-foreground">
          {on ? messages.projects.changelogPublicOn : messages.projects.changelogPublicOff}. {hint}
        </span>
      </div>
    );
  }
  return (
    <label data-touch htmlFor={id} className="flex cursor-pointer items-start gap-3">
      <span className="flex h-[21px] items-center">
        <Checkbox
          id={id}
          checked={on}
          aria-describedby={`${id}-hint`}
          onCheckedChange={(value) => onChange(value === true)}
        />
      </span>
      <span className="grid gap-0.5">
        <span className="font-medium">{messages.projects.changelogPublicLabel}</span>
        <span id={`${id}-hint`} className="text-meta text-muted-foreground">
          {hint}
        </span>
      </span>
    </label>
  );
}

const editRoute = getRouteApi('/_app/w/$ws/settings/projects/$project');

/** One project: its fields, and Archive (`project.update`, `project.archive`). */
export function EditProjectPage() {
  const workspace = useWorkspace();
  const { project: projectParam } = editRoute.useParams();
  const project = useQuery(projectQuery(workspace.slug, projectParam));

  if (project.isPending) return <LoadingState />;
  if (project.isError) {
    if (isNotFound(project.error)) return <NotFound />;
    return (
      <ErrorState
        what={messages.projects.what}
        error={project.error}
        onRetry={() => void project.refetch()}
      />
    );
  }
  // The form keeps what was typed when the project is read again after a live update. A
  // launch date moved by the launch milestone starts it again, so that a save of
  // the form does not put the earlier date back.
  return (
    <>
      <EditProjectForm
        key={`${project.data.id}:${project.data.launchDate ?? ''}`}
        project={project.data}
      />
      <ProjectPlanning project={project.data} />
    </>
  );
}

function EditProjectForm({ project }: { project: Project }) {
  const workspace = useWorkspace();
  const { me } = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const workspaceId = workspace.entry.workspace.id;
  const archived = project.archivedAt !== null;
  // R75: the launch date follows the launch milestone; clearing it unlinks the milestone.
  const plan = useQuery({
    ...planQuery(workspace.slug, project.key),
    enabled: project.launchMilestoneId !== null,
  });
  const launchMilestone = plan.data?.milestones.find((one) => one.id === project.launchMilestoneId);
  const launchHint =
    project.launchMilestoneId === null
      ? undefined
      : messages.projects.launchFollows(launchMilestone?.name ?? null);
  const mayEdit = !archived && canUpdateProject(me, workspaceId, project.id);
  const mayArchive = !archived && canArchiveProject(me, workspaceId, project.id);

  const [values, setValues] = useState<ProjectValues>({
    name: project.name,
    key: project.key,
    slug: project.slug,
    kind: project.kind,
    ships: shipsChoiceOf(project.shipsTo),
    locales: project.locales.join(', '),
    launchDate: project.launchDate ?? '',
  });
  const [errors, setErrors] = useState<Partial<Record<ProjectField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  // The public changelog: off until someone turns it on.
  const [changelogPublic, setChangelogPublic] = useState(project.changelogPublic);

  const base = `/workspaces/${seg(workspace.slug)}/projects/${seg(project.key)}`;

  const save = useMutation({
    mutationFn: (body: unknown) => api('PATCH', base, projectSchema, { body }),
    onSuccess: async (updated) => {
      await queryClient.invalidateQueries({ queryKey: keys.projects(workspace.slug) });
      toast.success(messages.common.saved);
      if (updated.key !== project.key) {
        await navigate({
          to: '/w/$ws/settings/projects/$project',
          params: { ws: workspace.slug, project: updated.key },
          replace: true,
        });
      }
    },
    onError: (error) => {
      const { field, message } = refusal(error);
      if (field === 'slug' || field === 'key') setErrors({ [field]: message });
      else setFormError(message);
    },
  });

  const archive = useMutation({
    mutationFn: () => api('POST', `${base}/archive`, projectSchema, { body: {} }),
    onSuccess: async (done) => {
      setConfirmArchive(false);
      await queryClient.invalidateQueries({ queryKey: keys.projects(workspace.slug) });
      toast.success(messages.projects.archived(done.name));
      await navigate({ to: '/w/$ws/settings/projects', params: { ws: workspace.slug } });
    },
    onError: (error) => {
      setConfirmArchive(false);
      setFormError(errorMessage(error));
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const parsed = check(values);
    if (!parsed.success) {
      setErrors(fieldErrors<ProjectField>(parsed.error, sentences, messages.validation.required));
      return;
    }
    setErrors({});
    const next = parsed.data;
    const patch = {
      ...(next.name !== project.name ? { name: next.name } : {}),
      ...(next.key !== project.key ? { key: next.key } : {}),
      ...(next.slug !== project.slug ? { slug: next.slug } : {}),
      ...(next.kind !== project.kind ? { kind: next.kind } : {}),
      ...(next.launchDate !== project.launchDate ? { launchDate: next.launchDate } : {}),
      ...(next.locales.join(',') !== project.locales.join(',') ? { locales: next.locales } : {}),
      ...(next.shipsTo.join(',') !== project.shipsTo.join(',') ? { shipsTo: next.shipsTo } : {}),
      ...(changelogPublic !== project.changelogPublic ? { changelogPublic } : {}),
    };
    if (Object.keys(patch).length === 0) {
      toast.success(messages.common.saved);
      return;
    }
    save.mutate(patch);
  };

  return (
    <section>
      <BackToList />
      <PageHeader title={messages.projects.editTitle(project.name)} />
      {project.archivedAt ? (
        <Notice className="mb-6">
          {messages.projects.archivedNotice(formatDateTime(project.archivedAt))}
        </Notice>
      ) : null}
      <form onSubmit={submit} className="grid max-w-xl gap-4" noValidate>
        <ProjectFields
          values={values}
          errors={errors}
          readOnly={!mayEdit}
          onChange={(patch) => setValues((previous) => ({ ...previous, ...patch }))}
          launchHint={launchHint}
        />
        <PublicChangelog
          on={changelogPublic}
          path={`/changelog/${workspace.slug}/${project.slug}`}
          readOnly={!mayEdit}
          onChange={setChangelogPublic}
        />
        <FormError message={formError} />
        {mayEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button type="submit" pending={save.isPending}>
              {messages.common.save}
            </Button>
            {mayArchive ? (
              <Button
                type="button"
                variant="outline"
                className="ml-auto"
                onClick={() => setConfirmArchive(true)}
              >
                {messages.projects.archive}
              </Button>
            ) : null}
          </div>
        ) : archived ? null : (
          <p className="text-muted-foreground">{messages.projects.readOnly}</p>
        )}
      </form>
      <ConfirmDialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title={messages.projects.archiveTitle(project.name)}
        confirmLabel={messages.projects.archive}
        pending={archive.isPending}
        onConfirm={() => archive.mutate()}
      >
        {messages.projects.archiveBody}
      </ConfirmDialog>
    </section>
  );
}
