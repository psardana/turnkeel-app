import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BotIcon, HistoryIcon, ListChecksIcon, SquareKanbanIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppFrame } from '@/components/app-header';
import { SessionContext, WorkspaceContext } from '@/features/session/session';
import { abilitiesIn } from '@/lib/permissions';
import { keys } from '@/lib/queries';
import { testId } from '@/testing/events';
import { BottomBar } from './bottom-bar';
import { TabBar, type TabEntry } from './tab-bar';

/** Renders `ui` on every path, under a router that starts at `path`. */
async function renderAt(path: string, ui: ReactNode) {
  // jsdom has no scrolling; the router asks for it on every navigation.
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  const root = createRootRoute({ component: () => <Outlet /> });
  const page = createRoute({ getParentRoute: () => root, path: '$', component: () => ui });
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  await router.load();
  return router;
}

const tab = (id: string, label: string, icon = HistoryIcon): NavItem => ({
  id,
  label,
  to: `/w/$ws/${id}` as NavItem['to'],
  visible: () => true,
  icon,
});

/** Twelve tabs, with counts on some. */
const twelve: TabEntry[] = [
  { item: tab('turn', 'Your turn', ListChecksIcon), count: 11 },
  { item: tab('board', 'Board', SquareKanbanIcon), count: 3 },
  { item: tab('agents', 'Agents', BotIcon), count: 1 },
  { item: tab('launch', 'Launch'), count: 2 },
  { item: tab('testing', 'Testing'), count: 6 },
  { item: tab('review', 'Review'), count: 2 },
  { item: tab('decisions', 'Decisions') },
  { item: tab('releases', 'Releases') },
  { item: tab('inbox', 'Inbox'), count: 4 },
  { item: tab('money', 'Money') },
  { item: tab('docs', 'Docs') },
  { item: tab('links', 'Links') },
];

/**
 * jsdom lays nothing out, so the widths the tab bar measures are set here: every tab
 * 100 px, More 80 px, and the bar as wide as `bar`.
 */
function layOut(bar: number) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => bar);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const kind = this.getAttribute('data-measure');
    const width = kind === 'tab' ? 100 : kind === 'more' ? 80 : 0;
    return { width, height: 44, x: 0, y: 0, top: 0, left: 0, right: width, bottom: 44 } as DOMRect;
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

const WORKSPACE = testId(1);

describe('the tab bar', () => {
  it('is a nav of links, the current one marked, each named with its count in words', async () => {
    await renderAt('/w/acme/board', <TabBar entries={twelve.slice(0, 3)} slug="acme" />);
    const bar = await screen.findByRole('navigation', { name: 'Project' });
    const links = within(bar).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('aria-label'))).toEqual([
      'Your turn, 11 waiting on you',
      'Board, 3 waiting on you',
      'Agents, 1 waiting on you',
    ]);
    expect(within(bar).getByRole('link', { name: /^Board/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(bar).queryByRole('tablist')).not.toBeInTheDocument();
    expect(within(bar).queryByRole('button', { name: /^More/ })).not.toBeInTheDocument();
  });

  it('folds the tabs that do not fit into More, which shows the sum of their counts', async () => {
    layOut(650);
    const user = userEvent.setup();
    await renderAt('/w/acme/turn', <TabBar entries={twelve} slug="acme" />);
    const bar = await screen.findByRole('navigation', { name: 'Project' });
    expect(
      within(bar)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Your turn11', 'Board3', 'Agents1', 'Launch2', 'Testing6']);
    // Review 2 and Inbox 4 are inside More.
    const more = within(bar).getByRole('button', { name: 'More, 6 waiting on you' });
    await user.click(more);
    const menu = screen.getByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.getAttribute('aria-label')),
    ).toEqual([
      'Review, 2 waiting on you',
      'Decisions',
      'Releases',
      'Inbox, 4 waiting on you',
      'Money',
      'Docs',
      'Links',
    ]);
  });

  it('gives the current tab the last visible place when it would be inside More', async () => {
    layOut(650);
    await renderAt('/w/acme/inbox', <TabBar entries={twelve} slug="acme" />);
    const bar = await screen.findByRole('navigation', { name: 'Project' });
    const links = within(bar).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('aria-label'))).toEqual([
      'Your turn, 11 waiting on you',
      'Board, 3 waiting on you',
      'Agents, 1 waiting on you',
      'Launch, 2 waiting on you',
      'Inbox, 4 waiting on you',
    ]);
    expect(links.at(-1)).toHaveAttribute('aria-current', 'page');
    expect(within(bar).getByRole('button', { name: 'More, 8 waiting on you' })).toBeInTheDocument();
  });
});

describe('the bottom bar on a phone', () => {
  it('holds Your turn, Board and Ship, and More with Marketing, Money and Inbox, and keeps the project', async () => {
    // What the shell gives the bar, so this fails when navigation.ts changes.
    const abilities = abilitiesIn(meWith('owner'), WORKSPACE);
    await renderAt(
      '/w/acme/turn?project=APP',
      <BottomBar
        entries={headerNavigation(abilities).map((item) => ({ item }))}
        slug="acme"
        project="APP"
      />,
    );
    const bar = await screen.findByRole('navigation', { name: 'Main' });
    const cells = within(bar).getAllByRole('link');
    expect(cells.map((cell) => cell.getAttribute('aria-label'))).toEqual([
      'Your turn',
      'Board',
      'Ship',
    ]);
    expect(cells[0]).toHaveAttribute('aria-current', 'page');
    expect(cells[1]).toHaveAttribute('href', '/w/acme/board?project=APP');
    expect(cells[2]).toHaveAttribute('href', '/w/acme/ship?project=APP');
    // Marketing is the fourth tab, so More shows.
    expect(within(bar).getByRole('button', { name: 'More' })).toBeInTheDocument();
  });

  it('has the first three tabs and More, which opens the others in a sheet with their counts', async () => {
    const user = userEvent.setup();
    await renderAt('/w/acme/testing', <BottomBar entries={twelve} slug="acme" />);
    const bar = await screen.findByRole('navigation', { name: 'Main' });
    expect(
      within(bar)
        .getAllByRole('link')
        .map((cell) => cell.getAttribute('aria-label')),
    ).toEqual([
      'Your turn, 11 waiting on you',
      'Board, 3 waiting on you',
      'Agents, 1 waiting on you',
    ]);
    // Launch 2, Testing 6, Review 2 and Inbox 4; Testing is open, so More is current.
    const more = within(bar).getByRole('button', { name: 'More, 14 waiting on you' });
    expect(more).toHaveAttribute('aria-current', 'page');
    await user.click(more);
    const sheet = screen.getByRole('dialog', { name: 'More' });
    expect(within(sheet).getAllByRole('link')).toHaveLength(9);
    expect(within(sheet).getByRole('link', { name: 'Testing, 6 waiting on you' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

describe('the shell', () => {
  let phone = false;
  beforeEach(() => {
    phone = false;
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('max-width: 639.98px') ? phone : false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function renderShell(me: Me, projects: Project[] = [], path = '/w/acme/turn') {
    const entry = me.workspaces[0];
    if (!entry) throw new Error('The person has no workspace.');
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    queryClient.setQueryData(keys.projectList('acme', false), projects);
    // The counts of the bars: the first page of Your turn.
    queryClient.setQueryData(
      turnQuery('acme', { project: null, list: 'mine', kind: null }).queryKey,
      {
        pages: [
          {
            today: '2026-11-11',
            now: '2026-11-11T09:00:00.000Z',
            todayEndsAt: '2026-11-12T00:00:00.000Z',
            counts: {
              yourTurn: 4,
              tabs: {
                board: 4,
                agents: 0,
                launch: 0,
                testing: 0,
                review: 0,
                decisions: 0,
                inbox: 0,
                money: 0,
                releases: 0,
              },
            },
            total: 4,
            lines: [],
          },
        ],
        pageParams: [null],
      },
    );
    return renderAt(
      path,
      <QueryClientProvider client={queryClient}>
        <SessionContext value={{ me, server }}>
          <WorkspaceContext value={{ entry, slug: 'acme', abilities: abilitiesIn(me, WORKSPACE) }}>
            <AppFrame>
              <h1 tabIndex={-1}>Page</h1>
            </AppFrame>
          </WorkspaceContext>
        </SessionContext>
      </QueryClientProvider>,
    ).then(async (router) => {
      await screen.findByRole('heading', { name: 'Page' });
      return router;
    });
  }

  it('from 640 px up has the header with the tab bar, which holds Your turn and Board with their counts', async () => {
    await renderShell(meWith('owner'));
    const header = screen.getByRole('banner');
    expect(within(header).getByRole('link', { name: 'Turnkeel' })).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: 'Workspace Acme' })).toBeInTheDocument();
    expect(
      within(header).getByRole('button', { name: 'Switch project, now All projects' }),
    ).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: 'Theme: Light' })).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: 'Account' })).toBeInTheDocument();
    const bar = within(header).getByRole('navigation', { name: 'Project' });
    expect(within(bar).getByRole('link', { name: 'Your turn, 4 waiting on you' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(bar).getByRole('link', { name: 'Board, 4 waiting on you' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
    // Not the demo workspace: no label.
    expect(screen.queryByText('Demo data')).not.toBeInTheDocument();
  });

  it('leaves out of the tab bar a tab the workspace turned off and one the person hid; a tab shows while one of its sections does', async () => {
    const me = meWith('owner');
    const entry = me.workspaces[0]!;
    await renderShell({
      ...me,
      workspaces: [
        {
          ...entry,
          workspace: {
            ...entry.workspace,
            tabsOff: ['money', 'assets', 'analytics', 'launch', 'testing'],
          },
          view: { ...entry.view, hiddenTabs: ['posts', 'listings'] },
        },
      ],
    });
    const bar = within(screen.getByRole('banner')).getByRole('navigation', { name: 'Project' });
    expect(within(bar).queryByRole('link', { name: /^Money/ })).toBeNull();
    // Marketing's three sections are off or hidden; Ship keeps Releases.
    expect(within(bar).queryByRole('link', { name: /^Marketing/ })).toBeNull();
    expect(within(bar).getByRole('link', { name: /^Ship/ })).toBeInTheDocument();
    expect(within(bar).getByRole('link', { name: /^Inbox/ })).toBeInTheDocument();
  });

  it('on a phone has the top bar and the bottom bar, and the theme is in the account menu', async () => {
    phone = true;
    const user = userEvent.setup();
    await renderShell(meWith('owner'));
    const header = screen.getByRole('banner');
    expect(within(header).queryByRole('link', { name: 'Turnkeel' })).not.toBeInTheDocument();
    expect(within(header).queryByRole('navigation')).not.toBeInTheDocument();
    expect(within(header).queryByRole('button', { name: /^Theme:/ })).not.toBeInTheDocument();
    const bottom = screen.getByRole('navigation', { name: 'Main' });
    expect(
      within(bottom).getByRole('link', { name: 'Your turn, 4 waiting on you' }),
    ).toHaveAttribute('aria-current', 'page');
    // The bottom bar comes after the content.
    expect(
      screen.getByRole('main').compareDocumentPosition(bottom) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await user.click(within(header).getByRole('button', { name: 'Account' }));
    const menu = screen.getByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitemradio')
        .map((item) => item.textContent),
    ).toEqual(['Light', 'Dark', 'System']);
  });

  it.each([
    ['from 640 px up', false],
    ['on a phone', true],
  ])('labels the demo workspace "Demo data", right after its name, %s', async (_, onPhone) => {
    phone = onPhone;
    await renderShell(meWith('owner', {}, true));
    const header = screen.getByRole('banner');
    const button = within(header).getByRole('button', { name: 'Workspace Acme' });
    expect(button.nextElementSibling).toHaveTextContent('Demo data');
  });

  it('gives the focus back to the menu button when the path stays', async () => {
    const user = userEvent.setup();
    await renderShell(meWith('owner'));
    const button = screen.getByRole('button', { name: 'Workspace Acme' });
    await user.click(button);
    await user.keyboard('{Escape}');
    expect(button).toHaveFocus();
  });

  it('gives a Tester one tab, Ship, and no workspace menu entry but the workspaces', async () => {
    const user = userEvent.setup();
    await renderShell(meWith(null, { [PROJECT]: 'tester' }));
    const bar = screen.getByRole('navigation', { name: 'Project' });
    expect(
      within(bar)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Ship']);
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Workspace Acme' }));
    const menu = screen.getByRole('menu');
    for (const name of ['Activity', 'Reference', 'Members', 'Projects', 'Settings']) {
      expect(within(menu).queryByRole('menuitem', { name })).not.toBeInTheDocument();
    }
  });

  it('gives a Tester no Manage projects and no New project in the phone sheet, not even hidden', async () => {
    phone = true;
    const user = userEvent.setup();
    await renderShell(meWith(null, { [PROJECT]: 'tester' }));
    await user.click(screen.getByRole('button', { name: /^Switch project/ }));
    const sheet = screen.getByRole('dialog', { name: 'Project' });
    expect(within(sheet).queryByText('Manage projects')).not.toBeInTheDocument();
    expect(within(sheet).queryByText('New project')).not.toBeInTheDocument();
  });

  it('gives a Tester no bottom bar on a phone either', async () => {
    phone = true;
    await renderShell(meWith(null, { [PROJECT]: 'tester' }));
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });
});

describe('the bar of sections', () => {
  const counts = {
    yourTurn: 20,
    tabs: {
      board: 3,
      agents: 1,
      launch: 2,
      testing: 6,
      review: 4,
      decisions: 1,
      inbox: 2,
      money: 1,
      releases: 0,
    },
  };

  it('holds the sections of Ship the person sees, in order, each a link with its count', async () => {
    const abilities = abilitiesIn(meWith('owner'), WORKSPACE);
    const views = sectionNavigation(shipSections, abilities, { off: ['listings'], hidden: [] });
    await renderAt(
      '/w/acme/ship/testing?project=APP',
      <SectionBar
        label="Ship"
        views={views}
        slug="acme"
        project="APP"
        counts={{ launch: 2, testing: 6 }}
      />,
    );
    const bar = screen.getByRole('navigation', { name: 'Ship sections' });
    const links = within(bar).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('aria-label'))).toEqual([
      'Launch, 2 waiting on you',
      'Testing, 6 waiting on you',
      'Releases',
    ]);
    expect(links[1]).toHaveAttribute('href', '/w/acme/ship/testing?project=APP');
    expect(links[1]).toHaveAttribute('aria-current', 'page');
    expect(links[0]).not.toHaveAttribute('aria-current');
  });

  it('lists a section the person hid while it is open, and a Tester’s Testing alone', () => {
    const abilities = abilitiesIn(meWith('owner'), WORKSPACE);
    const choice = { off: [], hidden: ['posts' as const] };
    expect(sectionNavigation(marketingSections, abilities, choice).map((one) => one.id)).toEqual([
      'assets',
      'analytics',
    ]);
    expect(
      sectionNavigation(marketingSections, abilities, choice, 'posts').map((one) => one.id),
    ).toEqual(['assets', 'posts', 'analytics']);
    const tester = abilitiesIn(meWith(null, { [PROJECT]: 'tester' }), WORKSPACE);
    expect(
      sectionNavigation(shipSections, tester, { off: ['testing'], hidden: [] }).map(
        (one) => one.id,
      ),
    ).toEqual(['testing']);
  });

  it('counts a tab as the sum of its sections shown: Ship is Launch and Testing, Marketing is Review', () => {
    const ship = sixTabs.find((one) => one.id === 'ship')!;
    const marketing = sixTabs.find((one) => one.id === 'marketing')!;
    expect(tabCount(ship, shipSections, counts)).toBe(8);
    // Launch's lines are its gates and listings: they count while either shows.
    expect(
      tabCount(
        ship,
        shipSections.filter((one) => one.id === 'listings'),
        counts,
      ),
    ).toBe(2);
    expect(
      tabCount(
        ship,
        shipSections.filter((one) => one.id === 'testing'),
        counts,
      ),
    ).toBe(6);
    expect(tabCount(marketing, marketingSections, counts)).toBe(4);
    expect(tabCount(sixTabs[0]!, sixTabs[0]!.views, counts)).toBe(20);
    // Releases counts its Release lines while it shows.
    const withReleases = { ...counts, tabs: { ...counts.tabs, releases: 3 } };
    expect(tabCount(ship, shipSections, withReleases)).toBe(11);
    expect(
      tabCount(
        ship,
        shipSections.filter((one) => one.id !== 'releases'),
        withReleases,
      ),
    ).toBe(8);
    expect(tabCount(ship, shipSections, undefined)).toBeUndefined();
  });
});
