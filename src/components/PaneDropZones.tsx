import { useState } from 'react';
import { dropZone, zoneRect, FILE_MIME, TAB_MIME, VIEW_MIME, type FileDragPayload, type ViewDragPayload } from '@/lib/dnd';
import type { Edge, PaneContent } from '@/lib/panes';

interface PaneDropZonesProps {
  /** Which ways this pane still has room to split, so the highlight shows what
   *  will actually happen rather than a split that silently becomes a move. */
  canSplit: { vertical: boolean; horizontal: boolean };
  onDropContent: (content: PaneContent, zone: Edge | 'center') => void;
}

/** The five drop targets laid over one pane while a drag is in flight: four
 *  edges that split, and a centre that shows the session in this pane instead.
 *  The highlight is the literal shape the pane will become.
 *
 *  Mounted only mid-drag (App watches dragstart/dragend), so it never sits
 *  between the pointer and the terminal underneath. */
export default function PaneDropZones({ canSplit, onDropContent }: PaneDropZonesProps) {
  const [zone, setZone] = useState<Edge | 'center' | null>(null);

  return (
    <div
      className="absolute inset-0 z-30"
      onDragOver={(e) => {
        e.preventDefault();
        // Must be an effect the source's `effectAllowed` permits: a tab is
        // moved between panes, a file is copied out of the explorer. Asking for
        // 'move' against a source that allowed only 'copy' makes the browser
        // cancel the drop outright — no drop event, just a no-drop cursor.
        e.dataTransfer.dropEffect = 'move';
        const next = dropZone(e, e.currentTarget.getBoundingClientRect());
        // Bailing on an unchanged value keeps the highlight from flickering,
        // same trick the tab strip's insertion line uses.
        setZone((z) => (z === next ? z : next));
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setZone(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        const where = zone ?? dropZone(e, e.currentTarget.getBoundingClientRect());
        setZone(null);
        // Three sources, one shape. A malformed payload can only come from
        // another app, so it's dropped rather than thrown on.
        try {
          const view = e.dataTransfer.getData(VIEW_MIME);
          if (view) {
            const { sessionId, tool } = JSON.parse(view) as ViewDragPayload;
            onDropContent({ kind: 'session', sessionId, tool }, where);
            return;
          }
          const file = e.dataTransfer.getData(FILE_MIME);
          if (file) {
            const { dir, path } = JSON.parse(file) as FileDragPayload;
            onDropContent({ kind: 'file', dir, path }, where);
            return;
          }
        } catch {
          return;
        }
        // A sidebar row drags the session itself, which means its Claude view.
        const sessionId = e.dataTransfer.getData(TAB_MIME);
        if (sessionId) onDropContent({ kind: 'session', sessionId, tool: 'claude' }, where);
      }}
    >
      {zone && (
        <div
          className="absolute bg-primary/12 border border-primary pointer-events-none"
          style={zoneRect(zone, canSplit)}
        />
      )}
    </div>
  );
}
