import { cn } from '@/lib/utils';

/** An on/off toggle — the app's own, never the OS checkbox. */
export default function Switch({ checked, disabled, onChange, label }: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
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
