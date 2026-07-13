import { useState } from 'react';
import { Settings as SettingsIcon, Sparkles, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { patchSettings, useSettings } from '@/lib/settings-store';
import CustomizeTab from './CustomizeTab';

type SettingsTab = 'general' | 'customize';

const TABS: { id: SettingsTab; label: string; icon: typeof SlidersHorizontal }[] = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'customize', label: 'Customize', icon: Sparkles },
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

function GeneralTab() {
  const settings = useSettings();
  return (
    <div className="flex flex-col px-5 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground pb-1">
        Session bar
      </div>
      <SettingRow
        title="Show the session bar"
        description="A slim strip above the terminal with the session name and controls."
        checked={settings.showSessionBar}
        onChange={(v) => patchSettings({ showSessionBar: v })}
      />
      <SettingRow
        title="Show the Markdown toggle"
        description="The Terminal / Markdown switch in the bar. Off keeps the bar identity-only."
        checked={settings.showMarkdownToggle}
        disabled={!settings.showSessionBar}
        onChange={(v) => patchSettings({ showMarkdownToggle: v })}
      />
    </div>
  );
}

export default function SettingsView() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 h-10 px-4 border-b border-border shrink-0">
        <SettingsIcon size={14} className="text-muted-foreground shrink-0" />
        <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          Settings
        </span>
      </div>

      <div className="flex items-center gap-1 px-3 pt-2.5 border-b border-border shrink-0">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              className={cn(
                'relative flex items-center gap-1.5 px-3 py-1.5 rounded-t-sm text-[11.5px] cursor-pointer',
                'bg-transparent border-none font-inherit transition-colors duration-100',
                isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setActiveTab(tab.id)}
            >
              <Icon size={12} className="shrink-0" />
              <span>{tab.label}</span>
              {isActive && <span className="absolute left-0 right-0 -bottom-px h-0.5 rounded-full bg-primary" />}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {activeTab === 'general' && <GeneralTab />}
        {activeTab === 'customize' && <CustomizeTab />}
      </div>
    </div>
  );
}
