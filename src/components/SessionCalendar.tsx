/**
 * A month grid of past sessions: one square per day, filled by how many
 * sessions ran that day and tinted with the hue of the folder that owned it.
 *
 * Shared by two surfaces (docs/features/session-history.md, home-screen.md).
 * Passing `onSelectDay` makes the busy days buttons that scope the History
 * list; omitting it leaves a readout, which is what Home wants — same rule the
 * cadence strip it replaced already followed.
 *
 * Density is drawn as alpha over the folder hue rather than as a colour ramp,
 * so a busy day can never be mistaken for a status colour (docs/design.md).
 */
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { dayKey, formatCompact, type CalendarDay, type CalendarMonth } from '@/lib/stats';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Fill opacity per density step; index 0 is "nothing ran" and paints nothing. */
const ALPHA = [0, 0.2, 0.4, 0.64, 0.92];

/** Which of the four steps a day's session count lands on. */
export function density(count: number): number {
  if (count === 0) return 0;
  if (count <= 1) return 1;
  if (count <= 3) return 2;
  if (count <= 5) return 3;
  return 4;
}

interface SessionCalendarProps {
  months: CalendarMonth[];
  /** Epoch ms — which square gets the "today" outline. */
  now: number;
  /** The picked day's key, or null. Only meaningful with `onSelectDay`. */
  selected?: string | null;
  /** Makes busy days clickable. Omit for a read-only grid. */
  onSelectDay?: (key: string) => void;
}

export default function SessionCalendar({ months, now, selected = null, onSelectDay }: SessionCalendarProps) {
  const [caption, setCaption] = useState<{ day: CalendarDay; label: string } | null>(null);
  const today = dayKey(now);
  const total = months.reduce((n, m) => n + m.total, 0);

  return (
    <div onPointerLeave={() => setCaption(null)}>
      {/* auto-fit + a capped track width: months centre as a block on a wide
          panel instead of hugging the left edge, and a single month doesn't
          stretch into a wall of oversized squares. */}
      <div
        className="grid gap-x-6 gap-y-4 justify-center"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 220px))' }}
        {...(onSelectDay ? {} : { role: 'img' as const, 'aria-label': `${total} sessions by day` })}
      >
        {months.map((month) => (
          <div key={month.key} className="min-w-0">
            <div className="flex items-baseline justify-between gap-2 mb-1.5">
              <span className="text-[10px] tracking-[0.16em] uppercase text-muted-foreground">{month.label}</span>
              <span className="text-[9.5px] tabular-nums text-muted-foreground/70">{month.total}</span>
            </div>
            <div className="grid grid-cols-7 gap-[2px] mb-[3px] text-[9px] text-center text-muted-foreground/70">
              {WEEKDAYS.map((w, i) => <span key={i}>{w}</span>)}
            </div>
            <div className="grid grid-cols-7 gap-[2px]">
              {Array.from({ length: month.leading }, (_, i) => <span key={`lead-${i}`} />)}
              {month.days.map((day, i) => {
                const level = density(day.count);
                const label = `${month.label} ${day.date} — ${day.count} session${day.count === 1 ? '' : 's'}`;
                const style = level > 0
                  ? { background: `hsl(${day.hue} 55% 58% / ${ALPHA[level]})`, animationDelay: `${i * 8}ms` }
                  : undefined;
                const className = cn(
                  'relative aspect-square min-w-0 grid place-items-center rounded-sm p-0 font-inherit',
                  'border border-transparent bg-white/[0.025] text-[10px] tabular-nums text-foreground/20',
                  // The date has to survive the fill: brighter at level 3, and
                  // flipped to ink at 4, where the fill is lighter than the type.
                  level > 0 && 'dash-mark',
                  level === 3 && 'text-white/60',
                  level === 4 && 'text-background/70',
                  day.key === today && 'border-border-hover text-foreground/60',
                  day.key === selected && 'border-primary text-primary',
                );

                const dayLabel = `${month.label.slice(0, 3)} ${day.date}`;
                return onSelectDay && day.count > 0 ? (
                  <button
                    key={day.key}
                    type="button"
                    title={label}
                    aria-label={label}
                    aria-pressed={day.key === selected}
                    className={cn(className, 'cursor-pointer hover:brightness-[1.35]')}
                    style={style}
                    onPointerEnter={() => setCaption({ day, label: dayLabel })}
                    onClick={() => onSelectDay(day.key)}
                  >
                    {day.date}
                  </button>
                ) : (
                  <span
                    key={day.key}
                    title={label}
                    className={className}
                    style={style}
                    onPointerEnter={() => day.count > 0 && setCaption({ day, label: dayLabel })}
                  >
                    {day.date}
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* hover caption — what that day actually holds, not a prompt out of context */}
      <div className="mt-2.5 h-5 flex items-center justify-center gap-2 text-[10.5px] text-muted-foreground min-w-0 tabular-nums">
        {caption ? (
          <>
            <b className="font-medium text-foreground shrink-0">{caption.label}</b>
            <span className="opacity-40">·</span>
            <span className="shrink-0">
              {caption.day.count} session{caption.day.count === 1 ? '' : 's'}
            </span>
            {caption.day.tokens > 0 && (
              <>
                <span className="opacity-40">·</span>
                <span className="shrink-0">{formatCompact(caption.day.tokens)} tokens</span>
              </>
            )}
            <span className="opacity-40">·</span>
            <span className="flex items-center gap-2 min-w-0">
              {caption.day.folders.slice(0, 3).map((f) => (
                <span key={f.name} className="flex items-center gap-1.5 min-w-0">
                  <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: `hsl(${f.hue} 55% 60%)` }} />
                  <span className="truncate">{f.name}</span>
                  {caption.day.folders.length > 1 && <span className="opacity-60">{f.count}</span>}
                </span>
              ))}
              {caption.day.folders.length > 3 && <span className="opacity-60">+{caption.day.folders.length - 3}</span>}
            </span>
          </>
        ) : (
          <span className="text-[10px] tracking-[0.1em] uppercase text-muted-foreground/60">
            {onSelectDay ? 'Point at a day for its totals, click it to see only that day' : 'Point at a day for its totals'}
          </span>
        )}
      </div>
    </div>
  );
}
