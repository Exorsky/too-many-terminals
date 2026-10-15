import { ArrowRight, FolderOpen, Plus } from 'lucide-react';
import { compactAge, recencyOf } from '@/lib/sessions';
import type { Tab } from '@/types';
import { StatusDot, type NewSessionKind } from './SessionsSidebar';

export interface ProjectHomeProps {
  name: string;
  /** The project's directory; null for the Inbox. */
  dir: string | null;
  /** The dot's style — the project's colour, or the Inbox's hollow ring. */
  hue: React.CSSProperties;
  /** This project's open sessions, newest first. */
  sessions: Tab[];
  lastUsed: Map<string, number>;
  now: number;
  onNewSession: (kind: NewSessionKind) => void;
  onOpenDirectory: (dir: string) => void;
  onSelect: (tabId: string) => void;
}

/** What the main area shows on going into a project whose sessions aren't on
 *  screen: the project itself, rather than a terminal from somewhere else
 *  under a sidebar that now says otherwise. Gone as soon as a session opens. */
export default function ProjectHome({
  name, dir, hue, sessions, lastUsed, now, onNewSession, onOpenDirectory, onSelect,
}: ProjectHomeProps) {
  const ageOf = (t: Tab) => recencyOf(t, t.resumeSessionId ? lastUsed.get(t.resumeSessionId) : undefined);
  const latest = sessions[0];
  const button = 'flex items-center gap-1.5 h-8 px-3.5 rounded-sm border bg-transparent text-[12px] cursor-pointer font-inherit hover:bg-hover';

  return (
    <div className="flex items-center justify-center h-full px-6">
      <div className="flex flex-col gap-3.5 w-[460px] max-w-full">
        <div className="flex items-center gap-2.5">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={hue} />
          <h1 className="m-0 text-[18px] font-semibold text-foreground truncate">{name}</h1>
        </div>
        <div className="font-mono text-[11px] text-muted-foreground truncate" title={dir ?? undefined}>
          {sessions.length} open session{sessions.length === 1 ? '' : 's'}
          {latest && ` · last used ${compactAge(ageOf(latest), now) || 'a while'} ago`}
          {dir && ` · ${dir}`}
        </div>
        <div className="flex flex-wrap gap-2 mt-1">
          <button type="button" className={`${button} border-border-hover text-foreground`} onClick={() => onNewSession('claude')}>
            <Plus size={13} className="text-primary" />New Claude session
          </button>
          <button type="button" className={`${button} border-border text-dim`} onClick={() => onNewSession('shell')}>Shell</button>
          {dir && (
            <button type="button" className={`${button} border-border text-dim`} onClick={() => onOpenDirectory(dir)}>
              <FolderOpen size={13} />Open folder
            </button>
          )}
        </div>

        {sessions.length > 0 && (
          <>
            <div className="mt-3 text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">Pick up where you left off</div>
            <div className="flex flex-col gap-1.5">
              {sessions.slice(0, 3).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-sm border border-border bg-transparent cursor-pointer font-inherit text-left hover:bg-hover hover:border-border-hover"
                  onClick={() => onSelect(tab.id)}
                >
                  <StatusDot tab={tab} />
                  <span className="flex-1 min-w-0 truncate text-[12px] text-foreground">{tab.name}</span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{compactAge(ageOf(tab), now)}</span>
                  <ArrowRight size={12} className="shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
