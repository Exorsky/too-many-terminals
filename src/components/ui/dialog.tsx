import type { ComponentProps, ReactNode } from 'react';
import { Dialog } from 'radix-ui';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Footer buttons: the quiet one (Cancel) and the one Enter means. */
export const DIALOG_BUTTON = 'px-3 h-7 rounded-sm border border-border bg-transparent text-[13px] text-dim cursor-pointer font-inherit hover:bg-hover hover:text-foreground';
export const DIALOG_PRIMARY = 'px-3 h-7 rounded-sm border border-border-hover bg-transparent text-[13px] text-foreground cursor-pointer font-inherit hover:bg-hover disabled:opacity-50 disabled:cursor-default';

export const DialogClose = Dialog.Close;

type ContentProps = Omit<ComponentProps<typeof Dialog.Content>, 'title' | 'children'>;

/** The app's modal: dimmed overlay, a titled header with ✕, a body and an
 *  optional footer bar. Size and position come in through `className`. */
export default function ModalDialog({
  open, onOpenChange, title, description, footer, className, children, ...content
}: ContentProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Read by screen readers only. */
  description: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          {...content}
          className={cn('fixed left-1/2 z-50 flex flex-col max-w-[calc(100vw-32px)] -translate-x-1/2 rounded-md border border-border bg-card shadow-lg', className)}
        >
          <div className="flex items-center h-11 px-4 border-b border-border shrink-0">
            <Dialog.Title className="m-0 text-[13px] font-semibold text-foreground">{title}</Dialog.Title>
            <Dialog.Description className="sr-only">{description}</Dialog.Description>
            <Dialog.Close
              aria-label="Close"
              className="ml-auto flex items-center justify-center w-6 h-6 rounded-sm border-none bg-transparent text-muted-foreground cursor-pointer hover:text-foreground hover:bg-hover"
            >
              <X size={13} />
            </Dialog.Close>
          </div>
          {children}
          {footer && <div className="flex items-center gap-2 h-12 px-4 border-t border-border shrink-0">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
