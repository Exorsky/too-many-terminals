import { AlertDialog } from 'radix-ui';
import { settleConfirm, usePendingConfirm } from '@/lib/confirm';

/** The app's one confirmation dialog — see `src/lib/confirm.ts`.
 *
 *  Focus starts on Cancel (Radix's AlertDialog default), so a reflexive Enter
 *  never destroys anything; Esc and a click outside both cancel. */
export default function ConfirmDialog() {
  const request = usePendingConfirm();
  return (
    <AlertDialog.Root open={request !== null} onOpenChange={(open) => { if (!open) settleConfirm(false); }}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <AlertDialog.Content
          className="fixed left-1/2 top-[30%] z-50 w-[380px] max-w-[calc(100vw-32px)] -translate-x-1/2 rounded-md border border-border bg-card p-4 shadow-lg"
        >
          <AlertDialog.Title className="m-0 text-[13px] font-semibold text-foreground">
            {request?.title}
          </AlertDialog.Title>
          {request?.body ? (
            <AlertDialog.Description className="mt-1.5 mb-0 text-[11.5px] leading-relaxed text-muted-foreground">
              {request.body}
            </AlertDialog.Description>
          ) : (
            <AlertDialog.Description className="sr-only">Confirm or cancel.</AlertDialog.Description>
          )}
          <div className="flex justify-end gap-2 mt-4">
            <AlertDialog.Cancel
              className="px-3 h-7 rounded-sm border border-border bg-transparent text-[11.5px] text-dim cursor-pointer font-inherit hover:bg-hover hover:text-foreground"
            >
              Cancel
            </AlertDialog.Cancel>
            <AlertDialog.Action
              className="px-3 h-7 rounded-sm border border-destructive/50 bg-destructive/10 text-[11.5px] text-destructive cursor-pointer font-inherit hover:bg-destructive/20"
              onClick={() => settleConfirm(true)}
            >
              {request?.confirmLabel}
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
