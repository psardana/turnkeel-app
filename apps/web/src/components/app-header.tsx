import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useRouter, useRouterState } from '@tanstack/react-router';
import { CheckIcon, ChevronDownIcon, PlusIcon, UserIcon } from 'lucide-react';
import { Brand } from '@/components/brand';
import { BottomBar } from '@/components/shell/bottom-bar';
import { TabBar, type TabEntry } from '@/components/shell/tab-bar';
import { ThemeMenuItems, ThemeSwitch } from '@/components/theme';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  forgetWorkspace,
  useOptionalWorkspace,
  useSession,
  type WorkspaceSession,
} from '@/features/session/session';
import { authClient } from '@/lib/auth-client';
import { usePhone } from '@/lib/media';
import { cn } from '@/lib/utils';
import { messages } from '@/messages';

export { useProjectKey };

/**
 * The tabs of the bars, with their counts: a tab with sections
 * counts what its sections shown to the person count.
 */
function useTabEntries(workspace: WorkspaceSession | null): TabEntry[] {
  const abilities = workspace?.abilities;
  const counts = useNavCounts(workspace);
  // The views the workspace turned off and the ones the person hid.
  const off = workspace?.entry.workspace.tabsOff;
  const hidden = workspace?.entry.view.hiddenTabs;
  return useMemo(() => {
    if (!abilities) return [];
    const choice = { off: off ?? [], hidden: hidden ?? [] };
    return headerNavigation(abilities, choice).map((item) => ({
      item,
      count: tabCount(item, sectionNavigation(item.views, abilities, choice), counts),
    }));
  }, [abilities, counts, off, hidden]);
}

/**
 * A view that lays itself out over the whole width and height under the header, such as
 * Your turn with its pane and the Board, which scroll on their own.
 */
function useFullBleed(): boolean {
  return useRouterState({
    select: (state) => state.matches.some((match) => match.staticData?.fullBleed === true),
  });
}

/**
 * "Demo data", right after the workspace name in the demo workspace, on every page.
 * It is never cut and never moved into a menu.
 */
function DemoLabel({ workspace }: { workspace: WorkspaceSession | null }) {
  if (!workspace?.entry.workspace.demo) return null;
  return <Badge className="shrink-0">{messages.nav.demoData}</Badge>;
}

/**
 * Remove demo data: `DELETE /workspaces/:ws` on the demo workspace, for its
 * Owner, after a confirm that says what it does. The app then asks for a name and makes
 * the person's own workspace (the welcome page), or opens another workspace they have.
 */
function RemoveDemoDialog({
  current,
  open,
  onOpenChange,
}: {
  current: WorkspaceSession;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const remove = async () => {
    setPending(true);
    setProblem(null);
    try {
      await apiVoid('DELETE', `/workspaces/${seg(current.slug)}`);
      forgetWorkspace(current.slug);
      await queryClient.invalidateQueries({ queryKey: meQuery.queryKey });
      onOpenChange(false);
      await navigate({ to: '/' });
      // The menu that opened this is gone with the demo: the next page's heading takes
      // the focus, the welcome page's or another workspace's.
      wantViewHeadingFocus();
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : messages.errors.network);
    } finally {
      setPending(false);
    }
  };
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={messages.nav.removeDemoTitle}
      confirmLabel={messages.nav.removeDemoConfirm}
      onConfirm={() => void remove()}
      pending={pending}
    >
      {messages.nav.removeDemoBody}
      {problem ? (
        <span role="alert" className="text-destructive mt-2 block">
          {problem}
        </span>
      ) : null}
    </ConfirmDialog>
  );
}

function WorkspaceMenu({ current }: { current: WorkspaceSession | null }) {
  const { me } = useSession();
  const name = current?.entry.workspace.name ?? messages.nav.workspaces;
  const focus = useNavigatingMenuFocus();
  const [removing, setRemoving] = useState(false);
  const canRemoveDemo = current?.entry.workspace.demo === true && current.entry.role === 'owner';
  return (
    <>
      {current && canRemoveDemo ? (
        <RemoveDemoDialog current={current} open={removing} onOpenChange={setRemoving} />
      ) : null}
      <DropdownMenu onOpenChange={focus.onOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="max-w-56 min-w-18 justify-start px-2 max-sm:max-w-[40vw]"
            aria-label={current ? messages.nav.workspaceMenu(name) : messages.nav.workspaces}
          >
            <span className="truncate" title={name}>
              {name}
            </span>
            <ChevronDownIcon className="text-muted-foreground" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-60" onCloseAutoFocus={focus.onCloseAutoFocus}>
          {/* The home page across every workspace, first for everyone. */}
          <DropdownMenuGroup>
            <DropdownMenuItem asChild>
              <Link to="/home">{messages.nav.home}</Link>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          {current ? (
            <>
              <DropdownMenuGroup>
                {workspaceMenu
                  .filter((item) => item.visible(current.abilities))
                  .map((item) => (
                    <DropdownMenuItem key={item.id} asChild>
                      <Link to={item.to} params={{ ws: current.slug }}>
                        {item.label}
                      </Link>
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuGroup>
            <DropdownMenuLabel>{messages.nav.workspaces}</DropdownMenuLabel>
            {me.workspaces.map((entry) => {
              const isCurrent = entry.workspace.id === current?.entry.workspace.id;
              return (
                <DropdownMenuItem key={entry.workspace.id} asChild>
                  <Link
                    to="/w/$ws"
                    params={{ ws: entry.workspace.slug }}
                    aria-current={isCurrent ? 'true' : undefined}
                  >
                    <span className="truncate" title={entry.workspace.name}>
                      {entry.workspace.name}
                    </span>
                    {isCurrent ? <CheckIcon className="ml-auto" aria-hidden="true" /> : null}
                  </Link>
                </DropdownMenuItem>
              );
            })}
            {me.canCreateWorkspace ? (
              <DropdownMenuItem asChild>
                <Link to="/workspaces/new">
                  <PlusIcon aria-hidden="true" />
                  {messages.nav.newWorkspace}
                </Link>
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuGroup>
          {canRemoveDemo ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setRemoving(true)}>
                {messages.nav.removeDemo}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/** A line of the project switcher's sheet on a phone. */
const sheetEntry =
  'flex min-h-12 w-full items-center gap-3 border-b px-4 text-left text-foreground focus-visible:outline-offset-[-2px] aria-disabled:text-muted-foreground';

/**
 * The project switcher: a quiet button with the project's name and, from 640 px up,
 * its key in mono. The menu lists All projects for someone with a workspace role, then
 * the projects with their keys, then Manage projects and New project. On
 * a phone the list opens in a sheet from the bottom, because a workspace with many
 * projects makes a menu too long for a phone.
 */
function ProjectSwitcher({ workspace, phone }: { workspace: WorkspaceSession; phone: boolean }) {
  const navigate = useNavigate();
  const projects = useQuery(projectsQuery(workspace.slug));
  const currentKey = useProjectKey();
  const { me } = useSession();
  const focus = useNavigatingMenuFocus();
  const [sheetOpen, setSheetOpen] = useState(false);
  const list = projects.data ?? [];
  const current = list.find((project) => project.key.toLowerCase() === currentKey?.toLowerCase());
  // A project whose cards and events the person's role may not read, as a Tester's,
  // leads nowhere yet, so its entry is listed and cannot be picked.
  const openable = new Set(
    list
      .filter((project) => canOpenProject(me, workspace.entry.workspace.id, project.id))
      .map((project) => project.id),
  );
  const path = useRouterState({ select: (state) => state.location.pathname });
  const view = path.endsWith('/activity')
    ? ('/w/$ws/activity' as const)
    : path.endsWith('/board/calendar')
      ? ('/w/$ws/board/calendar' as const)
      : path.endsWith('/board/timeline')
        ? ('/w/$ws/board/timeline' as const)
        : path.endsWith('/board/gantt')
          ? ('/w/$ws/board/gantt' as const)
          : path.endsWith('/board')
            ? ('/w/$ws/board' as const)
            : path.endsWith('/turn')
              ? ('/w/$ws/turn' as const)
              : path.endsWith('/ship/listings')
                ? ('/w/$ws/ship/listings' as const)
                : path.endsWith('/marketing/assets')
                  ? ('/w/$ws/marketing/assets' as const)
                  : path.endsWith('/marketing/posts')
                    ? ('/w/$ws/marketing/posts' as const)
                    : path.endsWith('/ship/testing')
                      ? ('/w/$ws/ship/testing' as const)
                      : path.endsWith('/ship/launch')
                        ? ('/w/$ws/ship/launch' as const)
                        : path.endsWith('/reference/decisions')
                          ? ('/w/$ws/reference/decisions' as const)
                          : path.endsWith('/ship/releases')
                            ? ('/w/$ws/ship/releases' as const)
                            : path.endsWith('/inbox')
                              ? ('/w/$ws/inbox' as const)
                              : null;
  // A Tester manages no projects: the switcher lists the projects they test, and no more.
  const manage = !workspace.abilities.onlyTester;

  // Picking a project shows that project in the view that is open: Activity keeps its
  // other filters, Your turn and the Board start without theirs. From any other page
  // the workspace's first view opens for the project.
  const pick = (key: string | null) => {
    const to = view ?? workspaceHome(workspace.abilities)?.to ?? '/w/$ws/activity';
    void navigate({
      to,
      params: { ws: workspace.slug },
      search: ((previous: Record<string, unknown>) => ({
        ...(to === '/w/$ws/activity' && view === to ? previous : {}),
        project: key ?? undefined,
      })) as never,
    });
  };

  const name = current ? current.name : messages.projectSwitcher.all;
  const trigger = (
    <Button
      variant="outline"
      className="max-w-64 min-w-18 justify-start px-2.5 max-sm:max-w-[38vw]"
      aria-label={messages.projectSwitcher.button(name)}
    >
      <span className="truncate" title={name}>
        {name}
      </span>
      {current && !phone ? (
        <span className="font-mono text-meta text-muted-foreground">{current.key}</span>
      ) : null}
      <ChevronDownIcon className="ml-auto text-muted-foreground" aria-hidden="true" />
    </Button>
  );
  const none =
    projects.isSuccess && list.length === 0 ? (
      <p className="px-1.5 py-1 text-muted-foreground max-sm:px-4 max-sm:py-3">
        {messages.projectSwitcher.none}
      </p>
    ) : null;

  if (phone) {
    const choose = (key: string | null) => {
      setSheetOpen(false);
      pick(key);
    };
    return (
      <Sheet
        open={sheetOpen}
        onOpenChange={(open) => {
          focus.onOpenChange(open);
          setSheetOpen(open);
        }}
      >
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent
          side="bottom"
          title={messages.projectSwitcher.label}
          onCloseAutoFocus={focus.onCloseAutoFocus}
        >
          <ul className="py-1">
            {workspace.abilities.readEvents ? (
              <li>
                <button
                  type="button"
                  className={sheetEntry}
                  aria-current={current ? undefined : 'true'}
                  onClick={() => choose(null)}
                  data-touch
                >
                  {messages.projectSwitcher.all}
                  {current ? null : <CheckIcon className="ml-auto size-4" aria-hidden="true" />}
                </button>
              </li>
            ) : null}
            {list.map((project) => {
              const may = openable.has(project.id);
              return (
                <li key={project.id}>
                  <button
                    type="button"
                    className={sheetEntry}
                    aria-current={current?.id === project.id ? 'true' : undefined}
                    aria-disabled={may ? undefined : 'true'}
                    onClick={() => {
                      if (may) choose(project.key);
                    }}
                    data-touch
                  >
                    <span className="truncate" title={project.name}>
                      {project.name}
                    </span>
                    <span className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-meta text-muted-foreground">
                      {project.key}
                      {current?.id === project.id ? (
                        <CheckIcon className="size-4 text-foreground" aria-hidden="true" />
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {none}
          {/* Not rendered at all for a Tester, who has neither. */}
          {manage ? (
            <ul className="border-t py-1">
              <li>
                <Link
                  to="/w/$ws/settings/projects"
                  params={{ ws: workspace.slug }}
                  className={sheetEntry}
                  onClick={() => setSheetOpen(false)}
                  data-touch
                >
                  {messages.projectSwitcher.manage}
                </Link>
              </li>
              {workspace.abilities.createProject ? (
                <li>
                  <Link
                    to="/w/$ws/settings/projects/new"
                    params={{ ws: workspace.slug }}
                    className={sheetEntry}
                    onClick={() => setSheetOpen(false)}
                    data-touch
                  >
                    <PlusIcon className="size-4" aria-hidden="true" />
                    {messages.projectSwitcher.newProject}
                  </Link>
                </li>
              ) : null}
            </ul>
          ) : null}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <DropdownMenu onOpenChange={focus.onOpenChange}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64" onCloseAutoFocus={focus.onCloseAutoFocus}>
        <DropdownMenuGroup>
          <DropdownMenuLabel>{messages.projectSwitcher.label}</DropdownMenuLabel>
          {workspace.abilities.readEvents ? (
            <DropdownMenuItem onSelect={() => pick(null)}>
              {messages.projectSwitcher.all}
              {current ? null : <CheckIcon className="ml-auto" aria-hidden="true" />}
            </DropdownMenuItem>
          ) : null}
          {list.map((project) => (
            <DropdownMenuItem
              key={project.id}
              disabled={!openable.has(project.id)}
              onSelect={() => pick(project.key)}
            >
              <span className="truncate" title={project.name}>
                {project.name}
              </span>
              <span className="ml-auto flex items-center gap-1.5 font-mono text-meta text-muted-foreground">
                {project.key}
                {current?.id === project.id ? (
                  <CheckIcon className="text-foreground" aria-hidden="true" />
                ) : null}
              </span>
            </DropdownMenuItem>
          ))}
          {none}
        </DropdownMenuGroup>
        {manage ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <Link to="/w/$ws/settings/projects" params={{ ws: workspace.slug }}>
                  {messages.projectSwitcher.manage}
                </Link>
              </DropdownMenuItem>
              {workspace.abilities.createProject ? (
                <DropdownMenuItem asChild>
                  <Link to="/w/$ws/settings/projects/new" params={{ ws: workspace.slug }}>
                    <PlusIcon aria-hidden="true" />
                    {messages.projectSwitcher.newProject}
                  </Link>
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The account menu: the name, Account settings, Sign out, and on a phone the theme. */
function AccountMenu({ withTheme }: { withTheme: boolean }) {
  const { me, server } = useSession();
  const queryClient = useQueryClient();
  const signOut = async () => {
    await authClient.signOut();
    // Drafts kept on this device belong to the person who typed them.
    clearDrafts(me.user.id);
    // So are the assistant's suggestions, which a person who signs in next never sees.
    clearSuggestions();
    queryClient.clear();
    window.location.assign('/sign-in');
  };
  const focus = useNavigatingMenuFocus();
  return (
    <DropdownMenu onOpenChange={focus.onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={messages.nav.accountMenu}>
              <UserIcon aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{messages.nav.accountMenu}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-60" onCloseAutoFocus={focus.onCloseAutoFocus}>
        <div className="px-1.5 py-1">
          <p className="truncate font-medium">{me.user.name || me.user.email}</p>
          <p className="truncate text-meta text-muted-foreground">
            {me.local ? messages.nav.localOwner : me.user.email}
          </p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/account">{messages.nav.accountSettings}</Link>
        </DropdownMenuItem>
        {server.mode === 'server' ? (
          <DropdownMenuItem onSelect={() => void signOut()}>
            {messages.nav.signOut}
          </DropdownMenuItem>
        ) : null}
        {withTheme ? (
          <>
            <DropdownMenuSeparator />
            <ThemeMenuItems />
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SkipLink() {
  return (
    <a
      href="#content"
      className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-background focus:px-3 focus:py-2"
    >
      {messages.common.skipToContent}
    </a>
  );
}

/**
 * The brand, a link to `/`: the home page for a person with more than one workspace or
 * project, and the one workspace's first view for anyone else.
 */
function BrandLink() {
  return (
    <Link
      to="/"
      className="flex min-h-8 shrink-0 items-center rounded-lg px-1"
      aria-label={messages.appName}
      data-touch
    >
      <Brand />
    </Link>
  );
}

/**
 * The header from 640 px up. Row 1: the brand, the workspace
 * menu with the Demo data label, the project switcher, then the theme switch and the
 * account menu. Row 2: the tab bar. It spans the whole width and stays in place,
 * except in a window under 480 px high, where it scrolls with the page.
 */
function WideHeader({
  workspace,
  entries,
  project,
}: {
  workspace: WorkspaceSession | null;
  entries: TabEntry[];
  project: string | null;
}) {
  return (
    <header className="z-40 bg-background tall:sticky tall:top-0">
      <SkipLink />
      <div
        className={cn(
          'flex h-header min-w-0 items-center gap-1 px-6',
          (!workspace || entries.length === 0) && 'border-b',
        )}
      >
        <BrandLink />
        <span aria-hidden="true" className="mx-2 h-5 w-px shrink-0 bg-border" />
        <WorkspaceMenu current={workspace} />
        <DemoLabel workspace={workspace} />
        {workspace ? (
          <div className="ml-2 min-w-0">
            <ProjectSwitcher workspace={workspace} phone={false} />
          </div>
        ) : null}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <ThemeSwitch />
          <AccountMenu withTheme={false} />
        </div>
      </div>
      {workspace && entries.length > 0 ? (
        <TabBar entries={entries} slug={workspace.slug} project={project} />
      ) : null}
    </header>
  );
}

/**
 * The top bar on a phone: the workspace menu with the Demo data
 * label on the left; the project switcher and the account menu, which also holds the
 * theme, on the right. The brand is not shown; the view's `h1` is the first row of
 * the content.
 */
function PhoneTopBar({ workspace }: { workspace: WorkspaceSession | null }) {
  return (
    <header className="z-40 border-b bg-background tall:sticky tall:top-0">
      <SkipLink />
      <div className="flex h-topbar min-w-0 items-center gap-1 pr-2 pl-4">
        <div className="-ml-2 flex min-w-0 items-center gap-1">
          <WorkspaceMenu current={workspace} />
          <DemoLabel workspace={workspace} />
        </div>
        <div className="ml-auto flex min-w-0 items-center gap-1">
          {workspace ? <ProjectSwitcher workspace={workspace} phone /> : null}
          <AccountMenu withTheme />
        </div>
      </div>
    </header>
  );
}

/**
 * When the person moves to another view, focus goes to its `h1`, so a screen reader
 * starts there and Tab goes on from the top of the content. A
 * change of the query alone, such as a filter, leaves focus where it is.
 */
function useFocusOnNavigate() {
  const router = useRouter();
  useEffect(
    () =>
      router.subscribe('onResolved', (event) => {
        if (!event.pathChanged || event.fromLocation === undefined) return;
        wantViewHeadingFocus();
      }),
    [router],
  );
}

/**
 * The shell of every signed-in page: the header, or on a phone the top bar, then the
 * page, then on a phone the bottom bar. The tab bar and the bottom bar hold what the
 * person's role opens; a role that opens none of the tabs gets neither bar.
 */
export function AppFrame({ children }: { children: ReactNode }) {
  const workspace = useOptionalWorkspace();
  const phone = usePhone();
  const entries = useTabEntries(workspace);
  const project = useProjectKey();
  const fullBleed = useFullBleed();
  // A Tester has one tab, Testing, and gets no bar at the bottom.
  const bottomBar =
    phone && workspace !== null && entries.length > 0 && !workspace.abilities.onlyTester;
  useFocusOnNavigate();
  return (
    <div className="flex min-h-dvh flex-col">
      {phone ? (
        <PhoneTopBar workspace={workspace} />
      ) : (
        <WideHeader workspace={workspace} entries={entries} project={project} />
      )}
      <main
        id="content"
        className={cn(
          fullBleed ? 'flex min-w-0 flex-1 flex-col' : 'page flex-1 py-6',
          bottomBar &&
            (fullBleed
              ? 'tall:pb-[calc(var(--bottombar-height)+env(safe-area-inset-bottom))]'
              : 'tall:pb-[calc(var(--bottombar-height)+env(safe-area-inset-bottom)+1.5rem)]'),
        )}
      >
        {children}
      </main>
      {bottomBar && workspace ? (
        <BottomBar entries={entries} slug={workspace.slug} project={project} />
      ) : null}
    </div>
  );
}
