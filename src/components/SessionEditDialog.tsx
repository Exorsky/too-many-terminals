import { useState } from 'react';
import { ChevronDown, Inbox } from 'lucide-react';
import { firstIssueKey, jiraOn, parseIssueInput, stripIssueKey } from '@/lib/jira';
import { useSettings } from '@/lib/settings-store';
import { folderName } from '@/lib/utils';
import { projectHue, type Tab } from '@/types';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger,
} from './ui/dropdown-menu';
import Switch from './ui/switch';
import ModalDialog, { DIALOG_BUTTON, DIALOG_PRIMARY, DialogClose } from './ui/dialog';

export interface SessionEdit {
  name: string;
  projectDir: string | null;
  pinned: boolean;
}

/** The Jira key lives in the name — that's what the chip, the hover card and
 *  "one ticket, one session" read — in the shape New session gives it. */
export function composeSessionName(label: string, key: string | null): string {
  const l = label.trim();
  if (!key) return l;
  return l ? `${key} · ${l}` : key;
}

/** Inbox icon or the project's colour dot — the marks New session's list uses. */
function ProjectMark({ dir, projects }: { dir: string | null; projects: string[] }) {
  if (!dir) return <Inbox size={12} className="shrink-0 text-muted-foreground" />;
  return <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: `hsl(${projectHue(projects.indexOf(dir))} 60% 62%)` }} />;
}

const FIELD = 'h-[30px] px-2.5 rounded-sm border border-border bg-background text-foreground placeholder:text-faint outline-none focus:border-border-hover';
const LABEL = 'text-[12px] font-semibold text-muted-foreground';

/** Rename plus the rest of what you set on a session — its Jira issue, its
 *  project, its pin — in one place. Mounted only while open, so every opening
 *  starts from the session as it is now. */
export default function SessionEditDialog({ tab, projects, onClose, onSave }: {
  tab: Tab;
  projects: string[];
  onClose: () => void;
  onSave: (edit: SessionEdit) => void;
}) {
  const settings = useSettings();
  const jira = jiraOn(settings);
  const startKey = jira ? firstIssueKey(tab.name, settings.jiraProjectKeys) : null;
  const startLabel = startKey ? stripIssueKey(tab.name, startKey) : tab.name;
  const initialLabel = startLabel === startKey ? '' : startLabel;
  const [label, setLabel] = useState(initialLabel);
  const [issueInput, setIssueInput] = useState(startKey ?? '');
  const [projectDir, setProjectDir] = useState(tab.projectDir);
  const [pinned, setPinned] = useState(!!tab.pinned);

  const key = jira ? parseIssueInput(issueInput, settings.jiraProjectKeys) : null;
  // Text that isn't a key would be silently dropped on save — refuse instead.
  const badIssue = jira && issueInput.trim() !== '' && !key;
  // Untouched name and issue keep the name exactly as it was: rebuilding it
  // would turn "ITA-123 Fix login" into "ITA-123 · Fix login" on a pin toggle.
  const name = key === startKey && label === initialLabel ? tab.name : composeSessionName(label, key);
  const canSave = name !== '' && !badIssue;

  const save = () => {
    if (!canSave) return;
    onSave({ name, projectDir, pinned });
    onClose();
  };

  return (
    <ModalDialog
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title="Edit session"
      description="Name, Jira issue, project and pin."
      className="top-[18%] w-[440px]"
      onKeyDown={(e) => {
        e.stopPropagation();
        // An Enter the Project menu already used to pick an item isn't a save:
        // it bubbles here through the portal before the pick has re-rendered.
        if (e.key === 'Enter' && !e.defaultPrevented && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); save(); }
      }}
      footer={(
        <>
          <DialogClose className={`${DIALOG_BUTTON} ml-auto`}>Cancel</DialogClose>
          <button type="button" disabled={!canSave} onClick={save} className={DIALOG_PRIMARY}>Save</button>
        </>
      )}
    >
      <div className="flex flex-col gap-3 px-4 py-3">
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Name</span>
          <input
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            className={`${FIELD} text-[13px] font-inherit`}
          />
        </label>

        {jira && (
          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>
              Jira issue <span className="font-normal text-faint">— a key or a link, empty to unlink</span>
            </span>
            <input
              value={issueInput}
              onChange={(e) => setIssueInput(e.target.value)}
              placeholder="ABC-123"
              spellCheck={false}
              autoComplete="off"
              className={`${FIELD} font-mono text-[12px]`}
            />
            {badIssue && (
              <span className="text-[11px] text-attention">
                Not a key from {settings.jiraProjectKeys.join(', ') || 'the projects in Settings › Jira'}
              </span>
            )}
          </label>
        )}

        <div className="flex flex-col gap-1.5">
          <span id="session-edit-project" className={LABEL}>Project</span>
          {/* The app's own menu, not the OS select: same look as ⋯ › Move to project. */}
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-labelledby="session-edit-project"
              className={`${FIELD} flex items-center gap-2 text-[13px] text-left cursor-pointer font-inherit`}
            >
              <ProjectMark dir={projectDir} projects={projects} />
              <span className="flex-1 truncate">{projectDir ? folderName(projectDir) : 'Inbox'}</span>
              <ChevronDown size={13} className="shrink-0 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width) max-h-64">
              <DropdownMenuRadioGroup value={projectDir ?? ''} onValueChange={(v) => setProjectDir(v || null)}>
                {[null, ...projects].map((p) => (
                  <DropdownMenuRadioItem key={p ?? ''} value={p ?? ''} className="text-[13px]" title={p ?? undefined}>
                    <ProjectMark dir={p} projects={projects} />
                    <span className="truncate">{p ? folderName(p) : 'Inbox'}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center justify-between">
          <span className={LABEL}>Pinned</span>
          <Switch checked={pinned} onChange={setPinned} label="Pinned" />
        </div>

        <div className="font-mono text-[11px] text-muted-foreground truncate" title={name}>{name || ' '}</div>
      </div>

    </ModalDialog>
  );
}
