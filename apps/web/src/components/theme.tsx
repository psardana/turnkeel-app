import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { messages } from '@/messages';

const icons = { light: SunIcon, dark: MoonIcon, system: MonitorIcon } as const;

/**
 * Light, Dark and System as radio items of a menu. The theme switch is this menu on its
 * own; on a phone the account menu holds the same items.
 */
export function ThemeMenuItems() {
  const { choice, setTheme } = useTheme();
  return (
    <>
      <DropdownMenuLabel>{messages.theme.label}</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={choice}
        onValueChange={(value) => setTheme(value as ThemeChoice)}
      >
        {themeChoices.map((option) => {
          const Icon = icons[option];
          return (
            <DropdownMenuRadioItem key={option} value={option}>
              <Icon aria-hidden="true" />
              {messages.theme[option]}
            </DropdownMenuRadioItem>
          );
        })}
      </DropdownMenuRadioGroup>
    </>
  );
}

/**
 * Light, Dark or System: a ghost icon button that shows the current choice. A menu
 * button, so it works from the keyboard like every other menu.
 */
export function ThemeSwitch() {
  const { choice } = useTheme();
  const Current = icons[choice];
  const name = `${messages.theme.label}: ${messages.theme[choice]}`;
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={name}>
              <Current aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{name}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-40">
        <ThemeMenuItems />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
