import { useState } from 'react';
import { dropZone, zoneRect, FILE_MIME, TAB_MIME, type FileDragPayload } from '@/lib/dnd';
import type { Edge } from '@/lib/panes';

interface PaneDropZonesProps {
  /** Which ways this pane still has room to split, so the highlight shows what
   *  will actually happen rather than a split that silently becomes a move. */
  canSplit: { vertical: boolean; horizontal: boolean };
  onDropTab: (tabId: string, zone: Edge | 'center') => void;
  onDropFile: (payload: FileDragPayload, zone: Edge | 'center') => void;
}

/** The five drop targets laid over one pane while a drag is in flight: four
 *  edges that split, and a centre that just moves the tab into this pane's
 *  strip. The highlight is the literal shape the pane will become.
 *
 *  Mounted only mid-drag (App watches dragstart/dragend), so it never sits
 *  between the pointer and the terminal underneath. */
export default function PaneDropZones({ canSplit, onDropTab, onDropFile }: PaneDropZonesProps) {
  const [zone, setZone] = useState<Edge | 'center' | null>(null);

  return (
    <div
      className="absolute inset-0 z-30"
      onDragOver={(e) => {
        e.preventDefault();
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
        const tabId = e.dataTransfer.getData(TAB_MIME);
        if (tabId) { onDropTab(tabId, where); return; }
        const raw = e.dataTransfer.getData(FILE_MIME);
        if (!raw) return;
        try {
          onDropFile(JSON.parse(raw) as FileDragPayload, where);
        } catch {
          // A malformed payload can only come from another app; ignore it.
        }
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
