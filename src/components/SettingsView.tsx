import { useState } from 'react';
import { Settings as SettingsIcon, Sparkles, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';

type SettingsTab = 'general' | 'customize';

const TABS: { id: SettingsTab; label: string; icon: typeof SlidersHorizontal }[] = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'customize', label: 'Customize', icon: Sparkles },
];

function GeneralTab() {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 text-center px-6 py-14 text-muted-foreground">
      <SettingsIcon size={20} className="text-[#33363f] mb-1" />
      <div className="text-[12.5px] text-foreground">No settings yet</div>
      <div className="text-[11px] max-w-[34ch] leading-relaxed">
        General app preferences will appear here.
      </div>
    </div>
  );
}

function CustomizeTab() {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 text-center px-6 py-14 text-muted-foreground">
      <Sparkles size={20} className="text-[#33363f] mb-1" />
      <div className="text-[12.5px] text-foreground">Customization coming soon</div>
      <div className="text-[11px] max-w-[34ch] leading-relaxed">
        Theming and appearance options will live here.
      </div>
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
