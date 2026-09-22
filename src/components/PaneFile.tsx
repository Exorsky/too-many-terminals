import { useMemo } from 'react';
import type { Tab } from '@/types';
import FileViewer from './FileViewer';

export interface PaneFileProps {
  content: { kind: 'file'; dir: string; path: string };
  /** The grid is on screen and this is its pane's active tab. */
  active: boolean;
  /** A link followed from the Markdown preview opens in this same pane. */
  onOpenFile: (dir: string, path: string) => void;
}

/** A file, on the workspace in its own right.
 *
 *  Not a session's file — a file. That is the difference between this and the
 *  Files tool: the tool browses one session's directory, this is a thing you
 *  dragged out of the explorer and parked next to a terminal, and it does not
 *  care which session (if any) it sits beside.
 *
 *  `FileViewer` takes a `Tab`, which is the one place in the app a file is
 *  still modelled as one; building it here keeps that shape from leaking into
 *  the pane model. Its name and its close button belong to the tab in the
 *  strip above, so there is no header here. See docs/features/panes.md. */
export default function PaneFile({ content, active, onOpenFile }: PaneFileProps) {
  const name = content.path.split(/[/\\]/).pop() || content.path;
  const tab = useMemo<Tab>(() => ({
    id: `file:${content.path}`,
    kind: 'file',
    name,
    shellId: null,
    cwd: content.dir,
    projectDir: null,
    resumeSessionId: null,
    exited: false,
    status: 'new',
    path: content.path,
  }), [content.dir, content.path, name]);

  return (
    <div className="relative flex flex-col flex-1 min-w-0 min-h-0 bg-background">
      <div className="relative flex-1 min-h-0">
        <FileViewer
          key={content.path}
          tab={tab}
          isVisible={active}
          onDirtyChange={() => {}}
          onOpenFile={onOpenFile}
        />
      </div>
    </div>
  );
}
