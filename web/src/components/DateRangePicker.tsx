import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  addDays, addMonths, diffDays, formatDayLong, formatDayWeekday, formatMonthYear, monthGrid, nights, startOfMonth,
} from '../format.ts';

export interface Range {
  start: string | null;
  end: string | null;
}

interface Blocked {
  startDate: string;
  endDate: string;
  mine?: boolean;
}

interface Props {
  today: string;
  blocked: Blocked[];
  maxDays?: number;
  value?: Range;
  onChange?: (r: Range) => void;
  /** Display-only calendar (no selection). */
  readOnly?: boolean;
  months?: number;
  /** Extend mode: start is fixed, choose a new end. */
  fixedStart?: string;
  minEnd?: string;
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export function DateRangePicker({ today, blocked, maxDays = 60, value = { start: null, end: null }, onChange, readOnly, months = 2, fixedStart, minEnd }: Props) {
  const [month, setMonth] = useState(() => startOfMonth(value.start ?? fixedStart ?? today));
  const [focusDay, setFocusDay] = useState<string>(value.end ?? value.start ?? minEnd ?? today);
  const grid = useRef<HTMLDivElement>(null);

  const isBlocked = useMemo(() => {
    const set = new Map<string, Blocked>();
    for (const b of blocked) for (let d = b.startDate; d <= b.endDate; d = addDays(d, 1)) set.set(d, b);
    return (day: string) => set.get(day);
  }, [blocked]);

  const start = fixedStart ?? value.start;
  const end = value.end;
  const choosingEnd = !!fixedStart || (!!value.start && !value.end);

  /** Can this day be picked right now? Returns a reason when not. */
  function why(day: string): string | null {
    if (readOnly) return null;
    if (fixedStart) {
      if (minEnd && day < minEnd) return 'Before the new due date can start';
      for (let d = addDays(fixedStart, 1); d <= day; d = addDays(d, 1)) if (isBlocked(d) && !isBlocked(d)!.mine) return 'Booked by someone else';
      return null;
    }
    if (day < today) return 'In the past';
    if (isBlocked(day)) return 'Already booked';
    if (choosingEnd && start && day >= start) {
      if (diffDays(start, day) + 1 > maxDays) return `Longer than ${maxDays} days`;
      for (let d = start; d <= day; d = addDays(d, 1)) if (isBlocked(d)) return 'Crosses a booking';
    }
    return null;
  }

  function pick(day: string) {
    if (readOnly || !onChange || why(day)) return;
    if (fixedStart) return onChange({ start: fixedStart, end: day });
    if (!value.start || value.end || day < value.start) onChange({ start: day, end: null });
    else onChange({ start: value.start, end: day });
  }

  function moveFocus(day: string) {
    setFocusDay(day);
    const first = month;
    const lastMonth = addMonths(month, months - 1);
    if (day < first) setMonth(startOfMonth(day));
    else if (startOfMonth(day) > lastMonth) setMonth(addMonths(startOfMonth(day), -(months - 1)));
    // Focus right away when the day is already on screen, so a quick Enter acts on it.
    const visible = grid.current?.querySelector<HTMLButtonElement>(`[data-day="${day}"]`);
    if (visible) visible.focus();
    else requestAnimationFrame(() => grid.current?.querySelector<HTMLButtonElement>(`[data-day="${day}"]`)?.focus());
  }

  function onKey(e: KeyboardEvent, day: string) {
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in moves) {
      e.preventDefault();
      moveFocus(addDays(day, moves[e.key]));
    } else if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault();
      moveFocus(addDays(day, e.key === 'PageDown' ? 30 : -30));
    }
  }

  const monthsToShow = Array.from({ length: months }, (_, i) => addMonths(month, i));
  const canGoBack = readOnly || month > startOfMonth(today);
  // The focusable day must be visible; fall back to the first visible enabled day.
  const visibleFocus = startOfMonth(focusDay) >= month && startOfMonth(focusDay) <= addMonths(month, months - 1) ? focusDay : month;

  let hint = '';
  if (!readOnly) {
    if (fixedStart) hint = end ? `New due date: ${formatDayLong(end)}` : 'Choose the new due date';
    else if (!start) hint = 'Choose your pickup day';
    else if (!end) hint = `Pickup ${formatDayWeekday(start)} — now choose the return day`;
    else hint = `${formatDayWeekday(start)} → ${formatDayWeekday(end)} · ${nights(start, end)}`;
  }

  return (
    <div className="calendar" ref={grid}>
      <div className="calendar-nav">
        <button type="button" className="icon-btn" onClick={() => setMonth(addMonths(month, -1))} disabled={!canGoBack} aria-label="Previous month">
          <ChevronLeft size={18} />
        </button>
        {!readOnly && (
          <p className="calendar-hint" aria-live="polite">
            {hint}
          </p>
        )}
        <button type="button" className="icon-btn" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month">
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="calendar-months">
        {monthsToShow.map((m) => (
          <div key={m} className="calendar-month">
            <h4 className="calendar-title">{formatMonthYear(m)}</h4>
            <div className="calendar-grid" role="grid" aria-label={formatMonthYear(m)}>
              <div role="row" className="calendar-row">
                {WEEKDAYS.map((w) => (
                  <span key={w} role="columnheader" className="calendar-wd" aria-hidden>
                    {w}
                  </span>
                ))}
              </div>
              {chunk(monthGrid(m), 7).map((week, wi) => (
                <div role="row" className="calendar-row" key={wi}>
                  {week.map((day, di) => {
                    if (!day) return <span key={di} role="gridcell" className="calendar-cell calendar-blank" />;
                    const booked = isBlocked(day);
                    const reason = why(day);
                    const inRange = !!(start && end && day >= start && day <= end);
                    const isStart = day === start;
                    const isEnd = day === end;
                    const classes = [
                      'calendar-day',
                      day === today && 'is-today',
                      day < today && 'is-past',
                      booked && (booked.mine ? 'is-mine' : 'is-booked'),
                      inRange && 'in-range',
                      isStart && 'is-start',
                      isEnd && 'is-end',
                    ]
                      .filter(Boolean)
                      .join(' ');
                    const status = booked ? (booked.mine ? 'your booking' : 'booked') : day < today ? 'past' : 'available';
                    return (
                      <span role="gridcell" key={day} className="calendar-cell" aria-selected={isStart || isEnd || inRange || undefined}>
                        {readOnly ? (
                          <span className={classes} aria-label={`${formatDayLong(day)}, ${status}`}>
                            {Number(day.slice(8))}
                          </span>
                        ) : (
                          <button
                            type="button"
                            data-day={day}
                            className={classes}
                            tabIndex={day === visibleFocus ? 0 : -1}
                            aria-disabled={!!reason || undefined}
                            aria-label={`${formatDayLong(day)}, ${reason ? reason.toLowerCase() : status}${isStart ? ', pickup' : ''}${isEnd ? ', return' : ''}`}
                            title={reason ?? undefined}
                            onClick={() => {
                              setFocusDay(day);
                              pick(day);
                            }}
                            onKeyDown={(e) => onKey(e, day)}
                          >
                            {Number(day.slice(8))}
                          </button>
                        )}
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="calendar-legend" aria-hidden>
        <span><i className="lg lg-free" /> Available</span>
        <span><i className="lg lg-booked" /> Booked</span>
        {blocked.some((b) => b.mine) && <span><i className="lg lg-mine" /> Yours</span>}
        {!readOnly && <span><i className="lg lg-selected" /> Your dates</span>}
      </div>
    </div>
  );
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
