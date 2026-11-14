import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { useLanguage } from '../i18n'
import { formatLocalDateTime, parseDateInput } from '../lib/devtools'

type DateTimePickerProps = {
  label: string
  value: string
  onChange: (value: string) => void
  hint?: string
  includeOffset?: boolean
}

type TimePart = 'hour' | 'minute' | 'second'

const pad = (value: number) => String(value).padStart(2, '0')

function validDate(value: string): Date | null {
  try { return parseDateInput(value) } catch { return null }
}

function calendarDate(year: number, month: number, day: number): Date {
  const date = new Date(0)
  date.setHours(12, 0, 0, 0)
  date.setFullYear(year, month, day)
  return date
}

/** Keep the selected side of a DST overlap when the edited wall time still exists at that offset. */
function keepOffsetWhenValid(source: Date, datePart: string, hour: number, minute: number, second: number, millisecond: number, fallback: Date): Date {
  const sourceLocal = formatLocalDateTime(source)
  const offset = formatLocalDateTime(source, true).slice(sourceLocal.length)
  const wantedLocal = `${datePart}T${pad(hour)}:${pad(minute)}:${pad(second)}${millisecond ? `.${String(millisecond).padStart(3, '0')}` : ''}`
  const candidate = validDate(wantedLocal + offset)
  return candidate && formatLocalDateTime(candidate) === wantedLocal ? candidate : fallback
}

export default function DateTimePicker({ label, value, onChange, hint, includeOffset: alwaysIncludeOffset = false }: DateTimePickerProps) {
  const { language, tr } = useLanguage()
  const id = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const focusDayAfterNavigation = useRef(false)
  const selected = validDate(value)
  const includeOffset = alwaysIncludeOffset || /(?:Z|[+-]\d{2}:\d{2}(?::\d{2})?)$/i.test(value.trim())
  const [open, setOpen] = useState(false)
  const [timeDraft, setTimeDraft] = useState<{ part: TimePart; value: string } | null>(null)
  const [view, setView] = useState(() => {
    const date = validDate(value) ?? new Date()
    return { year: date.getFullYear(), month: date.getMonth() }
  })
  const [focusedDay, setFocusedDay] = useState(() => (validDate(value) ?? new Date()).getDate())

  useLayoutEffect(() => {
    if (!open || !focusDayAfterNavigation.current) return
    gridRef.current?.querySelector<HTMLButtonElement>(`button[data-calendar-day="${focusedDay}"]`)?.focus()
    focusDayAfterNavigation.current = false
  }, [focusedDay, open, view])

  useEffect(() => {
    if (!open) return
    function closeIfOutside(event: Event) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setTimeDraft(null)
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', closeIfOutside, true)
    document.addEventListener('focusin', closeIfOutside, true)
    return () => {
      document.removeEventListener('pointerdown', closeIfOutside, true)
      document.removeEventListener('focusin', closeIfOutside, true)
    }
  }, [open])

  function toggle() {
    if (!open) {
      const date = selected ?? new Date()
      setView({ year: date.getFullYear(), month: date.getMonth() })
      setFocusedDay(date.getDate())
      focusDayAfterNavigation.current = true
    } else {
      setTimeDraft(null)
    }
    setOpen(!open)
  }

  function shiftMonth(offset: number) {
    const date = calendarDate(view.year, view.month + offset, 1)
    if (date.getFullYear() >= 0 && date.getFullYear() <= 9999) {
      setView({ year: date.getFullYear(), month: date.getMonth() })
      setFocusedDay((day) => Math.min(day, calendarDate(date.getFullYear(), date.getMonth() + 1, 0).getDate()))
    }
  }

  function handleDayKeyDown(event: KeyboardEvent<HTMLButtonElement>, day: number) {
    const current = calendarDate(view.year, view.month, day)
    let next: Date
    switch (event.key) {
      case 'ArrowLeft': next = calendarDate(view.year, view.month, day - 1); break
      case 'ArrowRight': next = calendarDate(view.year, view.month, day + 1); break
      case 'ArrowUp': next = calendarDate(view.year, view.month, day - 7); break
      case 'ArrowDown': next = calendarDate(view.year, view.month, day + 7); break
      case 'Home': next = calendarDate(view.year, view.month, day - (current.getDay() + 6) % 7); break
      case 'End': next = calendarDate(view.year, view.month, day + (7 - current.getDay()) % 7); break
      case 'PageUp':
      case 'PageDown': {
        const monthOffset = (event.key === 'PageUp' ? -1 : 1) * (event.shiftKey ? 12 : 1)
        const targetMonth = calendarDate(view.year, view.month + monthOffset, 1)
        const lastDay = calendarDate(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0).getDate()
        next = calendarDate(targetMonth.getFullYear(), targetMonth.getMonth(), Math.min(day, lastDay))
        break
      }
      default: return
    }
    event.preventDefault()
    if (next.getFullYear() < 0 || next.getFullYear() > 9999 || next.getTime() === current.getTime()) return
    focusDayAfterNavigation.current = true
    if (next.getFullYear() !== view.year || next.getMonth() !== view.month) {
      setView({ year: next.getFullYear(), month: next.getMonth() })
    }
    setFocusedDay(next.getDate())
  }

  function selectDay(day: number) {
    let date = selected ? new Date(selected.getTime()) : new Date(0)
    date.setFullYear(view.year, view.month, 1)
    date.setDate(day)
    if (!selected) date.setHours(0, 0, 0, 0)
    else if (includeOffset) {
      const datePart = formatLocalDateTime(calendarDate(view.year, view.month, day)).split('T')[0]
      date = keepOffsetWhenValid(selected, datePart, selected.getHours(), selected.getMinutes(), selected.getSeconds(), selected.getMilliseconds(), date)
    }
    onChange(formatLocalDateTime(date, includeOffset))
    triggerRef.current?.focus()
    setTimeDraft(null)
    setOpen(false)
  }

  function changeTime(part: TimePart, raw: string) {
    if (!/^\d{0,2}$/.test(raw)) return
    setTimeDraft({ part, value: raw })
    if (raw === '') return
    const number = Number(raw)
    const maximum = part === 'hour' ? 23 : 59
    if (!Number.isInteger(number) || number < 0 || number > maximum) return
    let date = selected ? new Date(selected.getTime()) : new Date()
    if (!selected) date.setHours(0, 0, 0, 0)
    if (part === 'hour') date.setHours(number)
    if (part === 'minute') date.setMinutes(number)
    if (part === 'second') date.setSeconds(number)
    if (selected && includeOffset) {
      const datePart = formatLocalDateTime(selected).split('T')[0]
      const hour = part === 'hour' ? number : selected.getHours()
      const minute = part === 'minute' ? number : selected.getMinutes()
      const second = part === 'second' ? number : selected.getSeconds()
      date = keepOffsetWhenValid(selected, datePart, hour, minute, second, selected.getMilliseconds(), date)
    }
    onChange(formatLocalDateTime(date, includeOffset))
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && open) {
      setTimeDraft(null)
      setOpen(false)
      triggerRef.current?.focus()
      event.stopPropagation()
    }
  }

  const first = calendarDate(view.year, view.month, 1)
  const offset = (first.getDay() + 6) % 7
  const days = calendarDate(view.year, view.month + 1, 0).getDate()
  const cells = Array.from({ length: Math.ceil((offset + days) / 7) * 7 }, (_, index) => index - offset + 1)
  const today = new Date()
  const weekdays = language === 'zh-CN' ? ['一', '二', '三', '四', '五', '六', '日'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  return <div ref={rootRef} className="devtool-datetime-field" onKeyDown={handleKeyDown}>
    <label className="devtool-label" htmlFor={id}>{label}</label>
    <div className="devtool-datetime-control">
      <input id={id} type="text" value={value.replace('T', ' ')} onChange={(event) => onChange(event.target.value)} placeholder={alwaysIncludeOffset ? 'YYYY-MM-DD HH:mm:ss±HH:mm' : 'YYYY-MM-DD HH:mm:ss'} spellCheck={false} autoComplete="off" />
      <button ref={triggerRef} type="button" className="devtool-datetime-trigger" onClick={toggle} aria-label={tr('打开日期和时间选择器', 'Open date and time picker')} aria-expanded={open} aria-controls={`${id}-calendar`}><CalendarDays size={17} /></button>
    </div>
    {hint && <small>{hint}</small>}
    {open && <div className="devtool-calendar" id={`${id}-calendar`} role="group" aria-label={label}>
      <div className="devtool-calendar-head">
        <button type="button" onClick={() => shiftMonth(-12)} aria-label={tr('上一年', 'Previous year')}><ChevronsLeft size={16} /></button>
        <button type="button" onClick={() => shiftMonth(-1)} aria-label={tr('上个月', 'Previous month')}><ChevronLeft size={16} /></button>
        <strong>{new Intl.DateTimeFormat(language, { year: 'numeric', month: 'long' }).format(first)}</strong>
        <button type="button" onClick={() => shiftMonth(1)} aria-label={tr('下个月', 'Next month')}><ChevronRight size={16} /></button>
        <button type="button" onClick={() => shiftMonth(12)} aria-label={tr('下一年', 'Next year')}><ChevronsRight size={16} /></button>
      </div>
      <div ref={gridRef} className="devtool-calendar-grid">
        {weekdays.map((day) => <span className="devtool-calendar-weekday" key={day}>{day}</span>)}
        {cells.map((day, index) => day < 1 || day > days
          ? <span key={`blank-${index}`} aria-hidden="true" />
          : <button key={day} type="button" data-calendar-day={day} tabIndex={day === focusedDay ? 0 : -1} onFocus={() => setFocusedDay(day)} onKeyDown={(event) => handleDayKeyDown(event, day)} onClick={() => selectDay(day)} aria-label={`${view.year}-${pad(view.month + 1)}-${pad(day)}`} aria-pressed={selected?.getFullYear() === view.year && selected.getMonth() === view.month && selected.getDate() === day} aria-current={today.getFullYear() === view.year && today.getMonth() === view.month && today.getDate() === day ? 'date' : undefined}>{day}</button>)}
      </div>
      <div className="devtool-calendar-time">
        <span>{tr('时间', 'Time')}</span>
        <input type="number" min={0} max={23} value={timeDraft?.part === 'hour' ? timeDraft.value : pad(selected?.getHours() ?? 0)} onChange={(event) => changeTime('hour', event.target.value)} onBlur={() => setTimeDraft(null)} aria-label={tr('小时', 'Hour')} />
        <b>:</b>
        <input type="number" min={0} max={59} value={timeDraft?.part === 'minute' ? timeDraft.value : pad(selected?.getMinutes() ?? 0)} onChange={(event) => changeTime('minute', event.target.value)} onBlur={() => setTimeDraft(null)} aria-label={tr('分钟', 'Minute')} />
        <b>:</b>
        <input type="number" min={0} max={59} value={timeDraft?.part === 'second' ? timeDraft.value : pad(selected?.getSeconds() ?? 0)} onChange={(event) => changeTime('second', event.target.value)} onBlur={() => setTimeDraft(null)} aria-label={tr('秒', 'Second')} />
      </div>
      <div className="devtool-calendar-footer"><button type="button" onClick={() => { const now = new Date(); onChange(formatLocalDateTime(now, includeOffset)); setView({ year: now.getFullYear(), month: now.getMonth() }); triggerRef.current?.focus(); setTimeDraft(null); setOpen(false) }}>{tr('当前时间', 'Current time')}</button></div>
    </div>}
  </div>
}
