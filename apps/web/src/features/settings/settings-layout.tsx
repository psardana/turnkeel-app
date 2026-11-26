import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useWorkspace } from '@/features/session/session';
import { messages } from '@/messages';

/**
 * Settings: one page with the list of its sections at the side
 * from 640 px, one section open at a time, each at its own address. On a phone the list
 * is a select at the top. The list holds only the sections the person's role does something in.
 */
export function SettingsLayout() {
  const workspace = useWorkspace();
  const phone = usePhone();
  const navigate = useNavigate();
  const selectId = useId();
  const path = useRouterState({ select: (state) => state.location.pathname });
  const current = settingsSectionOf(path, workspace.slug);
  const visible = settingsSections.filter((one) => one.visible(workspace.abilities));
  const groups: { id: SettingsGroup; label: string }[] = [
    { id: 'workspace', label: m.workspaceGroup(workspace.entry.workspace.name) },
    { id: 'yours', label: m.yoursGroup },
  ];

  if (phone) {
    return (
      <div className="grid min-w-0 gap-5">
        <div className="grid gap-1.5" data-settings-select>
          <label htmlFor={selectId} className="text-body font-medium">
            {m.section}
          </label>
          <NativeSelect
            id={selectId}
            className="w-full [&_select]:h-11"
            value={current?.id ?? ''}
            onChange={(event) => {
              const next = visible.find((one) => one.id === event.target.value);
              void navigate({
                to: next?.to ?? '/w/$ws/settings',
                params: { ws: workspace.slug },
              });
            }}
          >
            <NativeSelectOption value="">{m.title}</NativeSelectOption>
            {groups.map((group) => (
              <optgroup key={group.id} label={group.label}>
                {visible
                  .filter((one) => one.group === group.id)
                  .map((one) => (
                    <NativeSelectOption key={one.id} value={one.id}>
                      {one.label}
                    </NativeSelectOption>
                  ))}
              </optgroup>
            ))}
          </NativeSelect>
        </div>
        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    );
  }

  return (
    // From 640 px the list is at the side, never above the section: a column of its own,
    // narrower below 1024 px, beside a section that takes the rest.
    <div className="grid min-w-0 grid-cols-[10.5rem_minmax(0,1fr)] items-start gap-x-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-x-10">
      <nav aria-label={messages.nav.settingsLabel} className="grid gap-5" data-settings-list>
        <Link
          to="/w/$ws/settings"
          params={{ ws: workspace.slug }}
          activeOptions={{ exact: true }}
          className="ring-inside -mx-2 flex min-h-8 items-center rounded-lg px-2 font-semibold text-foreground hover:bg-muted aria-[current=page]:text-primary"
        >
          {m.title}
        </Link>
        {groups.map((group) => {
          const items = visible.filter((one) => one.group === group.id);
          if (items.length === 0) return null;
          return (
            <div key={group.id} className="grid gap-1">
              <p className="section-label">{group.label}</p>
              <ul className="grid">
                {items.map((one) => (
                  <li key={one.id}>
                    <Link
                      to={one.to}
                      params={{ ws: workspace.slug }}
                      className="ring-inside -mx-2 flex min-h-8 items-center rounded-lg border-l-2 border-transparent px-2 text-foreground-soft hover:bg-muted hover:text-foreground aria-[current=page]:border-primary aria-[current=page]:font-semibold aria-[current=page]:text-primary"
                    >
                      {one.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
      <div className="min-w-0" data-settings-section>
        <Outlet />
      </div>
    </div>
  );
}
