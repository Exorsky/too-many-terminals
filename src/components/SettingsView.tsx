import { useEffect, useState } from 'react';
import {
  Bell, Bot, FileText, FolderOpen, Link2, Settings as SettingsIcon, Sparkles, SlidersHorizontal, Moon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { patchSettings, useSettings } from '@/lib/settings-store';
import * as ipc from '@/lib/ipc';
import type { NewTabPosition } from '@/types';
import CustomizeTab from './CustomizeTab';

type SettingsCategory = 'interface' | 'notifications' | 'sessions' | 'integrations' | 'claude' | 'customize';

const CATEGORIES: { id: SettingsCategory; label: string; icon: typeof SlidersHorizontal }[] = [
  { id: 'interface', label: 'Interface', icon: SlidersHorizontal },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'sessions', label: 'Sessions', icon: Moon },
  { id: 'integrations', label: 'Integrations', icon: Link2 },
  { id: 'claude', label: 'Claude Code', icon: Bot },
  { id: 'customize', label: 'Customize', icon: Sparkles },
];

const NEW_TAB_OPTIONS: { label: string; value: NewTabPosition }[] = [
  { label: 'At the left edge', value: 'start' },
  { label: 'After the current tab', value: 'afterCurrent' },
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
        <div className="text-[13.5px] text-foreground">{title}</div>
        <div className="text-[12px] text-muted-foreground leading-relaxed">{description}</div>
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
        <div className="text-[13.5px] text-foreground">{title}</div>
        <div className="text-[12px] text-muted-foreground leading-relaxed">{description}</div>
      </div>
      <select
        aria-label={title}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="shrink-0 px-2 py-1 rounded-sm border border-border bg-card text-foreground text-[12px] cursor-pointer hover:border-border-hover focus:outline-none font-inherit"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

/** A free-text setting, saved when you leave the field — not on every
 *  keystroke, which would rewrite settings.json per character. */
function TextRow({ title, description, value, placeholder, mono, onCommit, aside }: {
  title: string;
  description: string;
  value: string;
  placeholder?: string;
  mono?: boolean;
  /** Return false to refuse the value: the field goes back to the saved one. */
  onCommit: (next: string) => boolean | void;
  aside?: React.ReactNode;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <div className="py-3 border-t border-border first:border-t-0">
      <div className="flex items-baseline gap-2">
        <div className="text-[13px] text-foreground">{title}</div>
        {aside && <div className="ml-auto text-[11px]">{aside}</div>}
      </div>
      <div className="text-[12px] text-muted-foreground leading-relaxed mb-2">{description}</div>
      <input
        aria-label={title}
        value={draft}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft !== value && onCommit(draft.trim()) === false) setDraft(value); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        className={cn(
          'w-full h-[30px] px-2.5 rounded-sm border border-border bg-card text-foreground text-[13px] outline-none',
          'focus:border-border-hover placeholder:text-faint',
          mono && 'font-mono text-[12px]',
        )}
      />
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
          className="px-2.5 py-1.5 rounded-sm border border-border bg-card text-foreground text-[12px] cursor-pointer hover:bg-raised hover:border-border-hover font-inherit"
        >
          Send a test notification
        </button>
        {state === 'sent' && <span className="text-[12px] text-success">Sent — check your notifications.</span>}
        {state === 'blocked' && <span className="text-[12px] text-attention">Notifications are blocked by the OS.</span>}
      </div>
      <div className="text-[12px] text-muted-foreground leading-relaxed pt-2">
        Nothing showing up? The OS may be silently blocking notifications for this app —{' '}
        {ipc.canOpenSystemNotificationSettings() ? (
          <>
            allow them in the{' '}
            <button
              onClick={() => ipc.openSystemNotificationSettings()}
              className="p-0 bg-transparent border-none font-inherit text-[12px] text-foreground underline cursor-pointer hover:text-muted-foreground"
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
      <div className="text-[12px] text-muted-foreground leading-relaxed pb-2">
        What shows around the terminal itself.
      </div>
      <SettingRow
        title="Show Markdown Preview"
        description="The Preview/Split controls docked to the tab strip for a readable Claude session."
        checked={settings.showMarkdownToggle}
        onChange={(v) => patchSettings({ showMarkdownToggle: v })}
      />
      <SettingRow
        title="Compact session list"
        description="One line per session in the sidebar: the name and its status dot, with no second line for what Claude is doing right now."
        checked={settings.compactList}
        onChange={(v) => patchSettings({ compactList: v })}
      />
      <div className="flex items-center gap-4 py-3 border-t border-border">
        <div className="flex-1 min-w-0">
          <div className="text-[13px] text-foreground">New tabs open</div>
          <div className="text-[12px] text-muted-foreground leading-relaxed">
            At the left edge, the strip reads newest to oldest and ⌘1 is always the one you just opened. After the current tab is what most terminals do, and keeps every other tab's position and number where it was.
          </div>
        </div>
        <select
          aria-label="New tabs open"
          value={settings.newTabPosition}
          onChange={(e) => patchSettings({ newTabPosition: e.target.value as NewTabPosition })}
          className="shrink-0 px-2 py-1 rounded-sm border border-border bg-card text-foreground text-[12px] cursor-pointer hover:border-border-hover focus:outline-none font-inherit"
        >
          {NEW_TAB_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
    </div>
  );
}

/** An environment variable's name, by convention: what this field is for. A
 *  token pasted here instead (mixed case, or a long base64-ish run) would be
 *  stored in plain text in settings.json, which is exactly what the field
 *  exists to avoid — so it's refused, not saved. */
export function isEnvVarName(v: string): boolean {
  return /^[A-Z_][A-Z0-9_]*$/.test(v);
}

function IntegrationsCategory() {
  const settings = useSettings();
  const [tokenFound, setTokenFound] = useState<boolean | null>(null);
  const [tokenVarError, setTokenVarError] = useState(false);
  useEffect(() => {
    if (!settings.jiraTokenVar) { setTokenFound(null); return; }
    let alive = true;
    ipc.jiraTokenFound(settings.jiraTokenVar).then((f) => { if (alive) setTokenFound(f); }).catch(() => {});
    return () => { alive = false; };
  }, [settings.jiraTokenVar]);

  return (
    <div className="flex flex-col px-5 py-4 max-w-xl">
      <div className="text-[12px] text-muted-foreground leading-relaxed pb-2">
        Jira issue keys like <span className="font-mono">PROJ-4821</span> become links in session names, tabs,
        terminal output and transcripts. Read-only: the app only ever reads an issue's title and status.
      </div>
      <TextRow
        title="Jira URL"
        description="Leave empty to turn issue links off."
        value={settings.jiraBaseUrl}
        placeholder="https://jira.example.com"
        mono
        onCommit={(v) => patchSettings({ jiraBaseUrl: v.replace(/\/+$/, '') })}
      />
      <TextRow
        title="Project keys"
        description="Only keys from these projects become links, so UTF-8 or SHA-256 never do. Links stay off until at least one is listed."
        value={settings.jiraProjectKeys.join(', ')}
        placeholder="PROJ, HELP, TASK"
        mono
        onCommit={(v) => patchSettings({
          jiraProjectKeys: v.split(/[\s,]+/).map((k) => k.trim().toUpperCase()).filter(Boolean),
        })}
      />
      <TextRow
        title="Token variable"
        description="The name of an environment variable holding a personal access token — looked up in the app's environment, then in the env block of ~/.claude/settings.json. The app stores the name, never the token. Without one, keys still link; the hover card just can't show the title and status."
        value={settings.jiraTokenVar}
        placeholder="JIRA_API_TOKEN"
        mono
        onCommit={(v) => {
          // Refused, not saved: and the field is cleared so the pasted token
          // doesn't linger on screen either.
          if (v && !isEnvVarName(v)) { setTokenVarError(true); patchSettings({ jiraTokenVar: '' }); return false; }
          setTokenVarError(false);
          patchSettings({ jiraTokenVar: v });
        }}
        aside={tokenVarError
          ? <span className="text-attention">That looks like the token itself — enter the variable&apos;s name, e.g. JIRA_API_TOKEN</span>
          : tokenFound === null ? null : tokenFound
            ? <span className="text-success">● found</span>
            : <span className="text-attention">● not found</span>}
      />
    </div>
  );
}

/** Claude Code's own global files — what every session reads before yours
 *  says anything. Opened in the app's editor, beside the session you're in. */
const CLAUDE_FILES = [
  { name: 'settings.json', title: 'Global settings', description: 'Permissions, environment, hooks and model — applied to every Claude session.' },
  { name: 'CLAUDE.md', title: 'Global instructions', description: 'The memory file every session reads, in every project.' },
  { name: 'keybindings.json', title: 'Keybindings', description: "Claude Code's own keyboard shortcuts." },
];

function ClaudeCategory({ onOpenFile }: { onOpenFile?: (dir: string, path: string) => void }) {
  const [dir, setDir] = useState<string | null>(null);
  const [present, setPresent] = useState<Set<string>>(new Set());
  useEffect(() => {
    let alive = true;
    ipc.homeDir().then((home) => {
      const claudeDir = `${home.replace(/[\\/]+$/, '')}/.claude`;
      if (!alive) return;
      setDir(claudeDir);
      return ipc.listDir(claudeDir).then((entries) => {
        if (alive) setPresent(new Set(entries.map((e) => e.name)));
      });
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  return (
    <div className="flex flex-col px-5 py-4 max-w-xl">
      <div className="text-[12px] text-muted-foreground leading-relaxed pb-2">
        Claude Code&apos;s global configuration in <span className="font-mono">~/.claude</span>. Changes apply to
        sessions started after you save.
      </div>
      {CLAUDE_FILES.map((f) => {
        const exists = present.has(f.name);
        const path = dir ? `${dir}/${f.name}` : null;
        return (
          <div key={f.name} className="flex items-center gap-4 py-3 border-t border-border first:border-t-0">
            <FileText size={15} className="shrink-0 text-muted-foreground" />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] text-foreground">
                {f.title} <span className="ml-1 font-mono text-[11px] text-muted-foreground">{f.name}</span>
              </div>
              <div className="text-[12px] text-muted-foreground leading-relaxed">
                {exists ? f.description : 'Not created yet.'}
              </div>
            </div>
            <button
              type="button"
              disabled={!exists || !path || !onOpenFile}
              className="shrink-0 h-7 px-3 rounded-sm border border-border bg-transparent text-foreground text-[12px] cursor-pointer hover:border-border-hover hover:bg-hover disabled:opacity-40 disabled:cursor-default font-inherit"
              onClick={() => { if (dir && path) onOpenFile?.(dir, path); }}
            >
              Open
            </button>
          </div>
        );
      })}
      <div className="pt-3 border-t border-border">
        <button
          type="button"
          disabled={!dir}
          className="inline-flex items-center gap-2 h-7 px-3 rounded-sm border border-border bg-transparent text-dim text-[12px] cursor-pointer hover:text-foreground hover:border-border-hover font-inherit"
          onClick={() => { if (dir) ipc.openDirectory(dir); }}
        >
          <FolderOpen size={13} />Open ~/.claude in {ipc.fileManagerName()}
        </button>
      </div>
    </div>
  );
}

function NotificationsCategory() {
  const settings = useSettings();
  return (
    <div className="flex flex-col px-5 py-4 max-w-xl">
      <div className="text-[12px] text-muted-foreground leading-relaxed pb-2">
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
      <div className="text-[12px] text-muted-foreground leading-relaxed pb-2">
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

export default function SettingsView({ onOpenFile }: {
  /** Open a file in the workspace's editor (Claude Code's global files). */
  onOpenFile?: (dir: string, path: string) => void;
} = {}) {
  const [category, setCategory] = useState<SettingsCategory>('interface');

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 h-10 px-4 border-b border-border shrink-0">
        <SettingsIcon size={14} className="text-muted-foreground shrink-0" />
        <span className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
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
                  'relative flex items-center gap-2 w-[calc(100%-12px)] mx-1.5 mb-0.5 px-2.5 py-1.5 rounded-sm text-[13px] cursor-pointer',
                  'bg-transparent border-none font-inherit transition-colors duration-100',
                  isActive ? 'text-foreground bg-raised' : 'text-muted-foreground hover:text-foreground hover:bg-hover',
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
          {category === 'integrations' && <IntegrationsCategory />}
          {category === 'claude' && <ClaudeCategory onOpenFile={onOpenFile} />}
          {category === 'customize' && <CustomizeTab />}
        </div>
      </div>
    </div>
  );
}
