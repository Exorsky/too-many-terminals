import { useState } from 'react';
import { Bell, Settings as SettingsIcon, Sparkles, SlidersHorizontal, Moon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { patchSettings, useSettings } from '@/lib/settings-store';
import * as ipc from '@/lib/ipc';
import CustomizeTab from './CustomizeTab';

type SettingsCategory = 'interface' | 'notifications' | 'sessions' | 'customize';

const CATEGORIES: { id: SettingsCategory; label: string; icon: typeof SlidersHorizontal }[] = [
  { id: 'interface', label: 'Interface', icon: SlidersHorizontal },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'sessions', label: 'Sessions', icon: Moon },
  { id: 'customize', label: 'Customize', icon: Sparkles },
];

const AUTO_SLEEP_OPTIONS = [
  { label: 'Off', value: 0 },
  { label: '2 minutes', value: 2 },
  { label: '5 minutes', value: 5 },
  { label: '15 minutes', value: 15 },
  { label: '30 minutes', value: 30 },
  { label: '60 minutes', value: 60 },
];

// Anthropic's usage endpoint rate-limits, so the backend won't call it more
// than once every 5 minutes regardless — offering anything faster here would
// just re-serve the same numbers.
const USAGE_REFRESH_OPTIONS = [
  { label: '5 minutes', value: 300 },
  { label: '15 minutes', value: 900 },
  { label: '30 minutes', value: 1800 },
];

function Switch({ checked, disabled, onChange, label }: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative w-8 h-[18px] rounded-full shrink-0 border-none cursor-pointer transition-colors duration-100',
        checked ? 'bg-primary' : 'bg-border-hover',
        disabled && 'opacity-40 cursor-not-allowed',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 w-3.5 h-3.5 rounded-full bg-background transition-[left] duration-100',
          checked ? 'left-4' : 'left-0.5',
        )}
      />
    </button>
  );
}

function SettingRow({ title, description, checked, disabled, onChange }: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-4 py-3 border-t border-border first:border-t-0">
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] text-foreground">{title}</div>
        <div className="text-[11px] text-muted-foreground leading-relaxed">{description}</div>
      </div>
      <Switch checked={checked} disabled={disabled} onChange={onChange} label={title} />
    </div>
  );
}

function ChoiceRow({ title, description, value, options, onChange }: {
  title: string;
  description: string;
  value: number;
  options: { label: string; value: number }[];
  onChange: (next: number) => void;
}) {
  return (
    <div className="flex items-center gap-4 py-3 border-t border-border first:border-t-0">
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] text-foreground">{title}</div>
        <div className="text-[11px] text-muted-foreground leading-relaxed">{description}</div>
      </div>
      <select
        aria-label={title}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="shrink-0 px-2 py-1 rounded-sm border border-border bg-card text-foreground text-[11px] cursor-pointer hover:border-border-hover focus:outline-none font-inherit"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function TestNotificationButton() {
  const [state, setState] = useState<'idle' | 'sent' | 'blocked'>('idle');
  const send = async () => {
    const granted = await ipc.ensureNotificationPermission();
    if (!granted) { setState('blocked'); return; }
    await ipc.notify('Too Many Terminals', 'Notifications are working.');
    setState('sent');
    setTimeout(() => setState('idle'), 2500);
  };
  return (
    <div className="py-3 border-t border-border">
      <div className="flex items-center gap-3">
        <button
          onClick={send}
          className="px-2.5 py-1.5 rounded-sm border border-border bg-card text-foreground text-[11px] cursor-pointer hover:bg-white/5 hover:border-border-hover font-inherit"
        >
          Send a test notification
        </button>
        {state === 'sent' && <span className="text-[11px] text-success">Sent — check your notifications.</span>}
        {state === 'blocked' && <span className="text-[11px] text-attention">Notifications are blocked by the OS.</span>}
      </div>
      <div className="text-[11px] text-muted-foreground leading-relaxed pt-2">
        Nothing showing up? The OS may be silently blocking notifications for this app —{' '}
        {ipc.canOpenSystemNotificationSettings() ? (
          <>
            allow them in the{' '}
            <button
              onClick={() => ipc.openSystemNotificationSettings()}
              className="p-0 bg-transparent border-none font-inherit text-[11px] text-foreground underline cursor-pointer hover:text-muted-foreground"
            >
              system notification settings
            </button>
            .
          </>
        ) : (
          <>allow them in your system&apos;s notification settings.</>
        )}
      </div>
    </div>
  );
}

function InterfaceCategory() {
  const settings = useSettings();
  return (
    <div className="flex flex-col px-5 py-4 max-w-xl">
      <div className="text-[11px] text-muted-foreground leading-relaxed pb-2">
        What shows around the terminal itself.
      </div>
      <SettingRow
        title="Show Markdown Preview"
        description="The Preview/Split controls docked to the tab strip for a readable Claude session."
        checked={settings.showMarkdownToggle}
        onChange={(v) => patchSettings({ showMarkdownToggle: v })}
      />
    </div>
  );
}

function NotificationsCategory() {
  const settings = useSettings();
  return (
    <div className="flex flex-col px-5 py-4 max-w-xl">
      <div className="text-[11px] text-muted-foreground leading-relaxed pb-2">
        Desktop alerts when a session needs you.
      </div>
      <SettingRow
        title="Notify when a session needs you"
        description="A desktop notification when a Claude session asks for input or finishes while the app isn't focused."
        checked={settings.notificationsEnabled}
        onChange={(v) => patchSettings({ notificationsEnabled: v })}
      />
      <TestNotificationButton />
    </div>
  );
}

function SessionsCategory() {
  const settings = useSettings();
  return (
    <div className="flex flex-col px-5 py-4 max-w-xl">
      <div className="text-[11px] text-muted-foreground leading-relaxed pb-2">
        Background behavior while a session sits idle.
      </div>
      <ChoiceRow
        title="Auto-sleep idle sessions"
        description="Free the process of an idle Claude session left off-screen this long. It stays in the sidebar and resumes right where it left off when you open it again."
        value={settings.autoSleepMinutes}
        options={AUTO_SLEEP_OPTIONS}
        onChange={(v) => patchSettings({ autoSleepMinutes: v })}
      />
      <ChoiceRow
        title="Usage refresh interval"
        description="How often the sidebar re-fetches your usage percentages — the reset countdowns tick live in between."
        value={settings.usageRefreshSeconds}
        options={USAGE_REFRESH_OPTIONS}
        onChange={(v) => patchSettings({ usageRefreshSeconds: v })}
      />
    </div>
  );
}

export default function SettingsView() {
  const [category, setCategory] = useState<SettingsCategory>('interface');

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 h-10 px-4 border-b border-border shrink-0">
        <SettingsIcon size={14} className="text-muted-foreground shrink-0" />
        <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          Settings
        </span>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="w-36 shrink-0 border-r border-border py-2 overflow-y-auto scrollbar-thin">
          {CATEGORIES.map(({ id, label, icon: Icon }) => {
            const isActive = id === category;
            return (
              <button
                key={id}
                className={cn(
                  'relative flex items-center gap-2 w-[calc(100%-12px)] mx-1.5 mb-0.5 px-2.5 py-1.5 rounded-sm text-[11.5px] cursor-pointer',
                  'bg-transparent border-none font-inherit transition-colors duration-100',
                  isActive ? 'text-foreground bg-white/6' : 'text-muted-foreground hover:text-foreground hover:bg-white/4',
                )}
                onClick={() => setCategory(id)}
              >
                {isActive && <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-primary" />}
                <Icon size={13} className="shrink-0" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex-1 min-w-0 overflow-y-auto scrollbar-thin">
          {category === 'interface' && <InterfaceCategory />}
          {category === 'notifications' && <NotificationsCategory />}
          {category === 'sessions' && <SessionsCategory />}
          {category === 'customize' && <CustomizeTab />}
        </div>
      </div>
    </div>
  );
}
