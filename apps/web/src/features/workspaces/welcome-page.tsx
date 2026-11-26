import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppFrame } from '@/components/app-header';
import { Field, FormError } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSession } from '@/features/session/session';
import { PlainHeader } from '@/features/sign-in/sign-in-page';
import { authClient } from '@/lib/auth-client';
import { messages } from '@/messages';

type WorkspaceField = 'product' | 'name' | 'slug' | 'key' | 'handle';

/**
 * The first run's one question: what you are
 * shipping and where. The name, what it is and, for an app, where it ships; your name
 * when sign-in has none. The workspace's name, its address, the card key and your handle
 * are worked out from the names and stay editable under More. One submit makes the
 * workspace and its first project (`POST /workspaces` with `project`); the kind sets which
 * tabs start off.
 */
function WorkspaceForm() {
  const { me, server } = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const askName = server.mode === 'server' && me.user.name.trim() === '';
  const [yourName, setYourName] = useState('');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [handle, setHandle] = useState(() =>
    handleFrom(me.user.name || (me.user.email.split('@')[0] ?? '')),
  );
  const [handleTouched, setHandleTouched] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<WorkspaceField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const showErrors = (found: Partial<Record<WorkspaceField, string>>) => {
    setErrors(found);
    // A problem with a field under More opens it, so the field can be seen and changed.
    if (moreFields.some((field) => found[field] !== undefined)) setMore(true);
  };

  const create = useMutation({
    mutationFn: async (body: CreateWorkspaceRequest) => {
      if (askName && yourName.trim() !== '') {
        await authClient.updateUser({ name: yourName.trim() });
      }
      return api('POST', '/workspaces', workspaceSchema, { body });
    },
    onSuccess: async (workspace) => {
      // The new workspace has to be in what the app knows of the person before it opens.
      await queryClient.refetchQueries({ queryKey: keys.me });
      await navigate({ to: '/w/$ws', params: { ws: workspace.slug } });
    },
    onError: (error) => {
      const { field, message } = refusal(error);
      if (field === 'slug' || field === 'handle' || field === 'key')
        showErrors({ [field]: message });
      else setFormError(message);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    // A name of one character makes no address of its own: the workspace's serves.
    const fromProduct = slugFrom(product);
    const projectSlug = fromProduct.length >= 2 ? fromProduct : slug.trim();
    const parsed = createWorkspaceRequestSchema.safeParse({
      name: name.trim() === '' ? product : name,
      slug: slug.trim(),
      handle: handle.trim(),
      kind,
      project: {
        name: product,
        key: key.trim(),
        slug: projectSlug,
        shipsTo: shipsToOf(ships, kind),
      },
    });
    if (product.trim() === '') {
      showErrors({ product: messages.validation.required });
      return;
    }
    if (!parsed.success) {
      const found: Partial<Record<WorkspaceField, string>> = {};
      const sentences: Record<WorkspaceField, string> = {
        product: messages.validation.nameLength,
        name: messages.validation.nameLength,
        slug: messages.validation.slug,
        key: messages.validation.key,
        handle: messages.validation.handle,
      };
      for (const issue of parsed.error.issues) {
        const named = fieldOf(issue.path);
        // The workspace's name is the product's until the person changes it.
        const field = named === 'name' && !nameTouched ? 'product' : named;
        found[field] ??= sentences[field];
      }
      showErrors(found);
      return;
    }
    setErrors({});
    create.mutate(parsed.data);
  };

  const changeProduct = (value: string) => {
    setProduct(value);
    if (!nameTouched) setName(value);
    if (!slugTouched && !nameTouched) setSlug(slugFrom(value));
    if (!keyTouched) setKey(keyFrom(value));
  };

  return (
    <form onSubmit={submit} className="grid max-w-md gap-4" noValidate>
      {askName ? (
        <Field label={messages.welcome.yourNameLabel}>
          {(control) => (
            <Input
              {...control}
              autoComplete="name"
              maxLength={DISPLAY_NAME_MAX}
              value={yourName}
              onChange={(event) => {
                setYourName(event.target.value);
                if (!handleTouched) setHandle(handleFrom(event.target.value));
              }}
            />
          )}
        </Field>
      ) : null}
      <Field
        label={messages.welcome.productLabel}
        hint={messages.welcome.productHint}
        error={errors.product}
      >
        {(control) => (
          <Input
            {...control}
            name="product"
            autoComplete="off"
            maxLength={80}
            value={product}
            onChange={(event) => changeProduct(event.target.value)}
          />
        )}
      </Field>
      <Field label={messages.welcome.kindLabel} hint={messages.welcome.kindHint(tabsOffFor(kind))}>
        {(control) => (
          <NativeSelect
            {...control}
            name="kind"
            className="w-full"
            value={kind}
            onChange={(event) => setKind(event.target.value as ProjectKind)}
          >
            {projectKinds.map((one) => (
              <NativeSelectOption key={one} value={one}>
                {messages.projects.kind(one)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </Field>
      {kind === 'app' ? <ShipsToField value={ships} onChange={setShips} /> : null}
      <div className="grid gap-4">
        <button
          type="button"
          aria-expanded={more}
          aria-controls={moreId}
          onClick={() => setMore(!more)}
          className="ring-inside -mx-1 flex min-h-8 w-fit items-center gap-1 rounded-lg px-1 text-left font-medium max-sm:min-h-11"
          data-touch
        >
          {more ? (
            <ChevronDownIcon className="size-4 text-muted-foreground" aria-hidden="true" />
          ) : (
            <ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden="true" />
          )}
          {messages.welcome.more}
        </button>
        <div id={moreId} hidden={!more} className="grid gap-4">
          <Field
            label={messages.welcome.nameLabel}
            hint={messages.welcome.nameHint}
            error={errors.name}
          >
            {(control) => (
              <Input
                {...control}
                name="name"
                autoComplete="organization"
                maxLength={80}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setNameTouched(true);
                  if (!slugTouched) setSlug(slugFrom(event.target.value));
                }}
              />
            )}
          </Field>
          <Field
            label={messages.welcome.slugLabel}
            hint={messages.welcome.slugHint}
            error={errors.slug}
          >
            {(control) => (
              <Input
                {...control}
                name="slug"
                autoCapitalize="none"
                spellCheck={false}
                value={slug}
                onChange={(event) => {
                  setSlug(event.target.value);
                  setSlugTouched(true);
                }}
              />
            )}
          </Field>
          <Field
            label={messages.welcome.keyLabel}
            hint={messages.welcome.keyHint}
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
                value={key}
                onChange={(event) => {
                  setKey(event.target.value.toUpperCase());
                  setKeyTouched(true);
                }}
              />
            )}
          </Field>
          <Field
            label={messages.welcome.handleLabel}
            hint={messages.welcome.handleHint}
            error={errors.handle}
          >
            {(control) => (
              <Input
                {...control}
                name="handle"
                autoCapitalize="none"
                spellCheck={false}
                value={handle}
                onChange={(event) => {
                  setHandle(event.target.value);
                  setHandleTouched(true);
                }}
              />
            )}
          </Field>
        </div>
      </div>
      <FormError message={formError} />
      <div>
        <Button type="submit" pending={create.isPending}>
          {messages.welcome.create}
        </Button>
      </div>
    </form>
  );
}

const demoAnswerSchema = z.object({ canLoad: z.boolean() });

function SignOutLine() {
  const { me, server } = useSession();
  const queryClient = useQueryClient();
  if (server.mode !== 'server') return null;
  return (
    <p className="mt-8 text-meta text-muted-foreground">
      {messages.welcome.signedInAs(me.user.email)}{' '}
      <button
        type="button"
        className="link"
        onClick={() => {
          void authClient.signOut().then(() => {
            clearDrafts(me.user.id);
            queryClient.clear();
            window.location.assign('/sign-in');
          });
        }}
      >
        {messages.nav.signOut}
      </button>
    </p>
  );
}

/**
 * First run: a person who is in no workspace. Whoever may create one
 * names it here; anyone else is told how accounts join.
 */
export function WelcomePage() {
  const { me } = useSession();
  // "Turnkeel", as a fresh load of this page is named, also after Remove demo data.
  useDocumentTitle([]);
  const headingRef = useCallback((node: HTMLHeadingElement | null) => {
    if (node) takeViewHeadingFocus(node);
  }, []);
  return (
    <CenteredPage>
      <PlainHeader />
      {me.canCreateWorkspace ? (
        <>
          <h1 ref={headingRef} tabIndex={-1} className="text-title focus-visible:outline-none">
            {messages.welcome.title}
          </h1>
          <p className="mt-2 mb-6 text-muted-foreground">{messages.welcome.intro}</p>
          <WorkspaceForm />
          <DemoChoice />
        </>
      ) : (
        <>
          <h1 ref={headingRef} tabIndex={-1} className="text-title focus-visible:outline-none">
            {messages.welcome.noneTitle}
          </h1>
          <p className="mt-2 text-muted-foreground">{messages.welcome.noneBody}</p>
        </>
      )}
      <SignOutLine />
    </CenteredPage>
  );
}

/** A further workspace, for a person who may create one. */
export function NewWorkspacePage() {
  const { me } = useSession();
  return (
    <AppFrame>
      <PageHeader title={messages.welcome.newTitle} intro={messages.welcome.intro} />
      {me.canCreateWorkspace ? (
        <WorkspaceForm />
      ) : (
        <p className="text-muted-foreground">{messages.welcome.noneBody}</p>
      )}
    </AppFrame>
  );
}
