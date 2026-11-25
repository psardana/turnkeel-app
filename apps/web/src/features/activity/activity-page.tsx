import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { Field } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { useStreamState } from '@/features/stream/use-workspace-stream';
import { actorsOf, collapseRuns, groupByDay, mergeEvents, type ActivityRow } from '@/lib/activity';
import { API_BASE, seg } from '@/lib/api';
import { dayBoundary, formatDateTime, formatDayHeading, formatTime } from '@/lib/dates';
import { fetchEvents, keys, membersQuery, projectsQuery, type EventFilters } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { messages } from '@/messages';
import { describeEvent, type DescribeContext, type ItemLink } from './describe';

const route = getRouteApi('/_app/w/$ws/activity');

function ItemAnchor({ link, label, slug }: { link: ItemLink | null; label: string; slug: string }) {
  if (link === null) return <span className="font-medium">{label}</span>;
  if (link.kind === 'project') {
    return (
      <Link
        to="/w/$ws/settings/projects/$project"
        params={{ ws: slug, project: link.key }}
        className="link font-medium"
      >
        {label}
      </Link>
    );
  }
  if (link.kind === 'card') {
    return (
      <Link
        to="/w/$ws/board"
        params={{ ws: slug }}
        search={{ project: link.key.slice(0, link.key.lastIndexOf('-')), card: link.key }}
        className="link font-mono font-medium"
      >
        {label}
      </Link>
    );
  }
  if (link.kind === 'decision') {
    return (
      <Link
        to="/w/$ws/reference/decisions"
        params={{ ws: slug }}
        search={{ decision: link.id.toLowerCase() }}
        className="link font-medium"
      >
        {label}
      </Link>
    );
  }
  if (link.kind === 'release') {
    return (
      <Link
        to="/w/$ws/ship/releases"
        params={{ ws: slug }}
        search={{ project: link.project, release: link.id.toLowerCase() }}
        className="link font-medium"
      >
        {label}
      </Link>
    );
  }
  if (link.kind === 'inbox') {
    return (
      <Link
        to="/w/$ws/inbox"
        params={{ ws: slug }}
        search={{ project: link.project, filter: 'all', item: link.id.toLowerCase() }}
        className="link font-medium"
      >
        {label}
      </Link>
    );
  }
  if (link.kind === 'docs') {
    return (
      <Link
        to="/w/$ws/reference/docs"
        params={{ ws: slug }}
        search={{ project: link.project }}
        className="link font-medium"
      >
        {label}
      </Link>
    );
  }
  if (link.kind === 'links') {
    return (
      <Link
        to="/w/$ws/reference/links"
        params={{ ws: slug }}
        search={link.project === null ? {} : { project: link.project }}
        className="link font-medium"
      >
        {label}
      </Link>
    );
  }
  if (link.kind === 'routines') {
    return (
      <Link to="/w/$ws/settings/routines" params={{ ws: slug }} className="link font-medium">
        {label}
      </Link>
    );
  }
  if (link.kind === 'agents') {
    return (
      <Link to="/w/$ws/settings/sessions" params={{ ws: slug }} className="link font-medium">
        {label}
      </Link>
    );
  }
  if (link.kind === 'members') {
    return (
      <Link to="/w/$ws/settings/members" params={{ ws: slug }} className="link font-medium">
        {label}
      </Link>
    );
  }
  return (
    <Link to="/w/$ws/settings" params={{ ws: slug }} className="link font-medium">
      {label}
    </Link>
  );
}

/** Who did it, as a holder mark: You, a person, an agent or the system. */
function actorHolder(event: Event, viewerId: string): Holder {
  if (event.actor.kind === 'system') return { kind: 'system' };
  if (event.actor.kind === 'agent') {
    return { kind: 'agent', name: event.actor.name || messages.activity.someone };
  }
  if (event.actor.id === viewerId) return { kind: 'you' };
  return { kind: 'person', name: event.actor.name || messages.activity.someone };
}

/**
 * A line of Activity. From 640 px up it is a grid of the time,
 * the actor, one sentence saying what they did, and the channel. On a phone it is the
 * sentence, then the actor, the channel and the time. The source order is the order
 * a screen reader reads: who, what, through which channel, when.
 */
function Row({
  row,
  context,
  slug,
  viewerId,
}: {
  row: ActivityRow;
  context: DescribeContext;
  slug: string;
  viewerId: string;
}) {
  const event = row.latest;
  const described = describeEvent(event, context);
  return (
    <li
      className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5 border-b py-2.5 [grid-template-areas:'what_what_what''who_via_when'] max-sm:min-h-11 sm:grid-cols-[56px_176px_minmax(0,1fr)_auto] sm:gap-x-3 sm:[grid-template-areas:'when_who_what_via']"
      data-seq={event.seq}
      data-type={event.type}
    >
      <HolderMark
        holder={actorHolder(event, viewerId)}
        className="[grid-area:who] max-sm:text-small sm:font-medium"
      />
      <p className="min-w-0 [grid-area:what]">
        {described.before}
        {described.item ? (
          <>
            {' '}
            <ItemAnchor link={described.item.link} label={described.item.label} slug={slug} />
          </>
        ) : null}
        {described.after ? ` ${described.after}` : null}
        {row.count > 1 ? (
          <span className="text-muted-foreground"> · {messages.activity.times(row.count)}</span>
        ) : null}
      </p>
      <span className="[grid-area:via] sm:justify-self-end">
        <Badge title={messages.activity.viaLabel(event.via)}>
          <span className="sr-only">{messages.activity.viaLabel(event.via)}</span>
          <span aria-hidden="true">{messages.activity.via(event.via)}</span>
        </Badge>
      </span>
      <time
        dateTime={event.at}
        title={formatDateTime(event.at)}
        className="text-small text-muted-foreground [grid-area:when] max-sm:justify-self-end sm:text-meta"
      >
        {formatTime(event.at)}
      </time>
    </li>
  );
}

/**
 * A line of Activity while it loads, in the shape of `Row`: the
 * time, the actor, the sentence and the channel from 640 px up; on a phone the
 * sentence over the actor and the time.
 */
function LoadingRow() {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1.5 py-2.5 [grid-template-areas:'what_what_what''who_._when'] max-sm:min-h-11 sm:grid-cols-[56px_176px_minmax(0,1fr)_auto] sm:gap-x-3 sm:[grid-template-areas:'when_who_what_via']">
      <Skeleton className="h-4 w-10 [grid-area:when] max-sm:h-3 max-sm:w-8" />
      <Skeleton className="h-4 w-28 [grid-area:who] max-sm:h-3 max-sm:w-20" />
      <Skeleton className="h-4 w-full max-w-md [grid-area:what]" />
      <Skeleton className="h-5 w-12 [grid-area:via] max-sm:hidden" />
    </div>
  );
}

/**
 * Area, who, and a range of days, each with a visible label. The project comes from
 * the project switcher. The values are part of the URL.
 */
function FilterFields({
  search,
  actors,
  areas,
  onChange,
  stacked,
}: {
  search: ActivitySearch;
  actors: readonly { id: string; name: string }[];
  areas: readonly EventArea[];
  onChange: (patch: FilterPatch) => void;
  stacked: boolean;
}) {
  const value = (raw: string) => (raw === '' ? undefined : raw);
  const label = stacked ? undefined : 'text-small font-normal text-muted-foreground';
  const width = stacked ? 'w-full' : 'w-44';
  // The area select is as wide as its longest option, "Workspace and projects", so
  // no option is cut off.
  const areaWidth = stacked ? 'w-full' : 'min-w-44';
  return (
    <form
      role="search"
      aria-label={messages.activity.filtersLabel}
      className={cn('flex items-end gap-2', stacked ? 'flex-col items-stretch gap-4' : 'flex-wrap')}
      onSubmit={(event) => event.preventDefault()}
    >
      <Field label={messages.activity.areaLabel} labelClassName={label}>
        {(control) => (
          <NativeSelect
            {...control}
            name="area"
            className={areaWidth}
            value={search.area ?? ''}
            onChange={(event) => onChange({ area: value(event.target.value) })}
          >
            <NativeSelectOption value="">{messages.activity.allAreas}</NativeSelectOption>
            {areas.map((area) => (
              <NativeSelectOption key={area} value={area}>
                {messages.activity.area(area)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </Field>
      <Field label={messages.activity.actorLabel} labelClassName={label}>
        {(control) => (
          <NativeSelect
            {...control}
            name="actor"
            className={width}
            value={search.actor ?? ''}
            onChange={(event) => onChange({ actor: value(event.target.value) })}
          >
            <NativeSelectOption value="">{messages.activity.anyone}</NativeSelectOption>
            {actors.map((actor) => (
              <NativeSelectOption key={actor.id} value={actor.id}>
                {actor.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </Field>
      <Field label={messages.activity.fromLabel} labelClassName={label}>
        {(control) => (
          <Input
            {...control}
            type="date"
            name="from"
            className={stacked ? undefined : 'w-40'}
            max={search.to}
            value={search.from ?? ''}
            onChange={(event) => onChange({ from: value(event.target.value) })}
          />
        )}
      </Field>
      <Field label={messages.activity.toLabel} labelClassName={label}>
        {(control) => (
          <Input
            {...control}
            type="date"
            name="to"
            className={stacked ? undefined : 'w-40'}
            min={search.from}
            value={search.to ?? ''}
            onChange={(event) => onChange({ to: value(event.target.value) })}
          />
        )}
      </Field>
      {setFilters(search) > 0 ? (
        <Button type="button" variant="outline" onClick={() => onChange(clearPatch)}>
          {messages.activity.clear}
        </Button>
      ) : null}
    </form>
  );
}

/** The filters: one row that wraps from 640 px up; on a phone, a sheet behind one button. */
function Filters(props: {
  search: ActivitySearch;
  actors: readonly { id: string; name: string }[];
  areas: readonly EventArea[];
  onChange: (patch: FilterPatch) => void;
}) {
  const phone = usePhone();
  const [open, setOpen] = useState(false);
  const active = setFilters(props.search);
  if (!phone) {
    return (
      <div className="mb-6">
        <FilterFields {...props} stacked={false} />
      </div>
    );
  }
  return (
    <div className="mb-4">
      <Sheet open={open} onOpenChange={setOpen}>
        {/* The trigger of the sheet, so the focus comes back to it when it closes. */}
        <SheetTrigger asChild>
          <Button variant="outline" aria-label={messages.activity.filtersToggleLabel(active)}>
            <ListFilterIcon aria-hidden="true" />
            {messages.activity.filtersToggle(active)}
          </Button>
        </SheetTrigger>
        <SheetContent side="bottom" title={messages.activity.filtersLabel}>
          <div className="p-4">
            <FilterFields {...props} stacked />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function LiveMark() {
  const state = useStreamState();
  const live = state === 'open';
  return (
    <span
      className="flex items-center gap-1.5 text-meta text-muted-foreground"
      title={live ? messages.activity.liveHint : messages.activity.pausedHint}
      data-stream={state}
    >
      <span
        aria-hidden="true"
        className={cn(
          'size-2 rounded-full',
          live ? 'bg-state-open' : 'border border-muted-foreground',
        )}
      />
      {live ? messages.activity.live : messages.activity.paused}
    </span>
  );
}

/** Whether the page is scrolled to its top, where new lines may come in by themselves. */
function useAtTop(): boolean {
  const [atTop, setAtTop] = useState(true);
  useEffect(() => {
    const update = () => setAtTop(window.scrollY < 48);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);
  return atTop;
}

/**
 * The Activity view: what happened in the workspace, newest first, read
 * from the event log. It pages by `seq`, its filters are part of the URL, and new
 * lines arrive through the live stream without a reload.
 */
export function ActivityPage() {
  const workspace = useWorkspace();
  const { slug, abilities } = workspace;
  const search = route.useSearch();
  const navigate = route.useNavigate();

  const projects = useQuery(projectsQuery(slug, true));
  const members = useQuery({ ...membersQuery(slug), enabled: abilities.readMembers });

  // A person who holds only project roles reads one project at a time,
  // and only a project where their role reads events: not one where they are Tester.
  // For them the other projects are not here at all.
  const needsProject = !abilities.readEvents;

  useEffect(() => {
    if (!projects.isSuccess) return;
    if (search.project !== undefined && !project) {
      // The URL names a project that is not here: the filter is dropped.
      void navigate({ search: (previous) => ({ ...previous, project: undefined }), replace: true });
    } else if (needsProject && !project && firstProject) {
      void navigate({
        search: (previous) => ({ ...previous, project: firstProject.key }),
        replace: true,
      });
    }
  }, [projects.isSuccess, search.project, project, needsProject, firstProject, navigate]);

  const filters = useMemo<EventFilters>(
    () => ({
      project: project?.id,
      area: search.area,
      actor: search.actor,
      from: search.from === undefined ? undefined : dayBoundary(search.from, 'start'),
      to: search.to === undefined ? undefined : dayBoundary(search.to, 'end'),
    }),
    [project?.id, search.area, search.actor, search.from, search.to],
  );

  const ready = projects.isSuccess && (search.project === undefined || project !== undefined);
  const events = useInfiniteQuery({
    queryKey: keys.eventList(slug, filters),
    queryFn: ({ pageParam, signal }) => fetchEvents(slug, filters, pageParam, signal),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.nextBefore,
    enabled: ready && (!needsProject || project !== undefined),
  });

  const loaded = useMemo(
    () => mergeEvents(events.data?.pages.map((page) => page.items) ?? []),
    [events.data],
  );

  const context = useMemo<DescribeContext>(
    () => ({
      workspaceName: workspace.entry.workspace.name,
      projects: new Map((projects.data ?? []).map((entry) => [entry.id, entry])),
      people: new Map(
        (members.data ?? []).map((person) => [
          person.user.id,
          person.user.name || person.user.email,
        ]),
      ),
    }),
    [workspace.entry.workspace.name, projects.data, members.data],
  );

  // Who can be picked: the members when the viewer may list them, and whoever the
  // loaded lines name, which is where agents and the system come from.
  const actors = useMemo(() => {
    const byId = new Map<string, { id: string; name: string }>();
    for (const person of members.data ?? []) {
      byId.set(person.user.id, {
        id: person.user.id,
        name: person.user.name || person.user.email,
      });
    }
    for (const actor of actorsOf(loaded)) {
      if (!byId.has(actor.id)) {
        byId.set(actor.id, {
          id: actor.id,
          name: actor.kind === 'system' ? messages.activity.system : actor.name,
        });
      }
    }
    if (search.actor !== undefined && !byId.has(search.actor)) {
      byId.set(search.actor, { id: search.actor, name: messages.activity.someone });
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [members.data, loaded, search.actor]);

  // Events about people show only to someone who may read the member list.
  const areas = eventAreas.filter(
    (area) =>
      (area !== 'people' || abilities.readMembers) && (area !== 'agents' || abilities.readAgents),
  );

  const change = (patch: FilterPatch) => {
    void navigate({
      search: (previous) => ({ ...previous, ...patch }) as ActivitySearch,
      replace: true,
    });
  };

  const filtered =
    search.area !== undefined ||
    search.actor !== undefined ||
    search.from !== undefined ||
    search.to !== undefined ||
    (!needsProject && search.project !== undefined);

  let body;
  if (projects.isError) {
    body = (
      <ErrorState
        what={messages.activity.what}
        error={projects.error}
        onRetry={() => void projects.refetch()}
      />
    );
  } else if (needsProject && projects.isSuccess && !firstProject) {
    body = (
      <EmptyState title={messages.activity.needsProjectTitle}>
        {messages.activity.needsProjectBody}
      </EmptyState>
    );
  } else if (events.isPending) {
    body = <LoadingRows rows={8} row={<LoadingRow />} />;
  } else if (events.isError) {
    body = (
      <ErrorState
        what={messages.activity.what}
        error={events.error}
        onRetry={() => void events.refetch()}
      />
    );
  } else if (days.length === 0) {
    body = filtered ? (
      <EmptyState
        title={messages.activity.emptyFilteredTitle}
        action={
          <Button variant="outline" onClick={() => change(clearPatch)}>
            {messages.activity.clear}
          </Button>
        }
      >
        {messages.activity.emptyFilteredBody}
      </EmptyState>
    ) : (
      <EmptyState title={messages.activity.emptyTitle}>{messages.activity.emptyBody}</EmptyState>
    );
  } else {
    body = (
      <div className="grid gap-6" aria-busy={events.isFetching}>
        {held > 0 ? (
          <div className="z-30 flex justify-center tall:sticky tall:top-[calc(var(--topbar-height)+0.5rem)] sm:tall:top-[calc(var(--shell-height)+0.5rem)]">
            <Button
              variant="outline"
              className="bg-background"
              onClick={() => {
                setCeiling(newest);
                heading.current?.scrollIntoView({ block: 'start' });
              }}
            >
              <ArrowUpIcon aria-hidden="true" />
              {messages.activity.newLines(held)}
            </Button>
          </div>
        ) : null}
        {days.map((day) => (
          <section key={day.day} aria-labelledby={`day-${day.day}`}>
            <h2 id={`day-${day.day}`} className="section-label border-b pb-2">
              {formatDayHeading(day.rows[0]?.latest.at ?? day.day)}
            </h2>
            <ol>
              {day.rows.map((row) => (
                <Row key={row.key} row={row} context={context} slug={slug} viewerId={me.user.id} />
              ))}
            </ol>
          </section>
        ))}
        {events.hasNextPage ? (
          <div>
            <Button
              variant="outline"
              pending={events.isFetchingNextPage}
              onClick={() => void events.fetchNextPage()}
            >
              {messages.activity.older}
            </Button>
          </div>
        ) : filtered ? null : (
          <p className="text-meta text-muted-foreground">{messages.activity.end}</p>
        )}
      </div>
    );
  }

  return (
    <section>
      <PageHeader
        ref={heading}
        title={messages.activity.title}
        project={project?.name}
        intro={messages.activity.intro}
        actions={
          <>
            <LiveMark />
            {abilities.exportEvents ? (
              <Button asChild variant="outline">
                <a
                  href={`${API_BASE}/workspaces/${seg(slug)}/events/export`}
                  download
                  title={messages.activity.exportHint}
                >
                  <DownloadIcon aria-hidden="true" />
                  {messages.activity.export}
                </a>
              </Button>
            ) : null}
          </>
        }
      />
      <Filters search={search} actors={actors} areas={areas} onChange={change} />
      {body}
    </section>
  );
}
