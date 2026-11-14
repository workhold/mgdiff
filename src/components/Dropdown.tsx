import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import './dropdown.css'

export type DropdownOption = {
  value: string
  label: string
  disabled?: boolean
}

export type DropdownProps = {
  value: string
  options: DropdownOption[]
  onChange: (value: string) => void
  ariaLabel?: string
  className?: string
  disabled?: boolean
  title?: string
}

type MenuPosition = {
  left: number
  top: number
  width: number
  maxHeight: number
}

function firstEnabled(options: DropdownOption[]): number {
  return options.findIndex((option) => !option.disabled)
}

function lastEnabled(options: DropdownOption[]): number {
  for (let index = options.length - 1; index >= 0; index -= 1) {
    if (!options[index].disabled) return index
  }
  return -1
}

function selectedEnabled(options: DropdownOption[], value: string): number {
  const selected = options.findIndex((option) => option.value === value && !option.disabled)
  return selected >= 0 ? selected : firstEnabled(options)
}

export default function Dropdown({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  disabled = false,
  title,
}: DropdownProps) {
  const listboxId = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const typeaheadRef = useRef({ query: '', at: 0 })
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(() => selectedEnabled(options, value))
  const [position, setPosition] = useState<MenuPosition | null>(null)

  const selectedLabel = options.find((option) => option.value === value)?.label ?? value
  const accessibleName = ariaLabel
    ? `${ariaLabel}: ${selectedLabel}`
    : title
      ? `${title}: ${selectedLabel}`
      : undefined

  const updatePosition = useCallback(() => {
    const button = buttonRef.current
    if (!button) return
    if (button.getClientRects().length === 0) {
      setOpen(false)
      return
    }

    const rect = button.getBoundingClientRect()
    const viewportWidth = document.documentElement.clientWidth
    const viewportHeight = window.innerHeight
    const gutter = 8
    const gap = 4
    const width = Math.min(viewportWidth - gutter * 2, Math.max(rect.width, 180))
    const left = Math.max(gutter, Math.min(rect.left, viewportWidth - gutter - width))
    const below = viewportHeight - rect.bottom - gap - gutter
    const above = rect.top - gap - gutter
    const placeAbove = below < 150 && above > below
    const maxHeight = Math.max(40, Math.min(260, placeAbove ? above : below))
    const contentHeight = menuRef.current?.scrollHeight ?? options.length * 36 + 8
    const visibleHeight = Math.min(maxHeight, contentHeight)
    const top = placeAbove ? rect.top - gap - visibleHeight : rect.bottom + gap

    setPosition((previous) => previous?.left === left && previous.top === top && previous.width === width && previous.maxHeight === maxHeight
      ? previous : { left, top, width, maxHeight })
  }, [options.length])

  useEffect(() => {
    setActiveIndex(selectedEnabled(options, value))
  }, [options, value])

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  useLayoutEffect(() => {
    if (!open) return
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePosition)
    if (buttonRef.current) observer?.observe(buttonRef.current)
    const visibilityObserver = typeof MutationObserver === 'undefined' ? null : new MutationObserver(updatePosition)
    let ancestor = buttonRef.current?.parentElement
    while (ancestor && visibilityObserver) {
      visibilityObserver.observe(ancestor, {
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'],
      })
      ancestor = ancestor.parentElement
    }
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      observer?.disconnect()
      visibilityObserver?.disconnect()
    }
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) return
    const handleOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const handleOutsideFocus = (event: FocusEvent) => {
      const target = event.target as Node
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', handleOutsidePointer, true)
    document.addEventListener('focusin', handleOutsideFocus, true)
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointer, true)
      document.removeEventListener('focusin', handleOutsideFocus, true)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open || activeIndex < 0) return
    const menu = menuRef.current
    const option = menu?.children.item(activeIndex) as HTMLElement | null
    if (!menu || !option) return
    if (option.offsetTop < menu.scrollTop) menu.scrollTop = option.offsetTop
    else if (option.offsetTop + option.offsetHeight > menu.scrollTop + menu.clientHeight) {
      menu.scrollTop = option.offsetTop + option.offsetHeight - menu.clientHeight
    }
  }, [activeIndex, open, position])

  useLayoutEffect(() => {
    if (open && position && menuRef.current) updatePosition()
  }, [open, position, updatePosition])

  const choose = (index: number) => {
    const option = options[index]
    if (!option || option.disabled) return
    if (option.value !== value) onChange(option.value)
    typeaheadRef.current = { query: '', at: 0 }
    setOpen(false)
    buttonRef.current?.focus()
  }

  const move = (direction: 1 | -1) => {
    if (!options.length) return
    let index = activeIndex
    for (let steps = 0; steps < options.length; steps += 1) {
      index = (index + direction + options.length) % options.length
      if (!options[index].disabled) {
        setActiveIndex(index)
        return
      }
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault()
        if (open) move(event.key === 'ArrowDown' ? 1 : -1)
        else {
          setActiveIndex(selectedEnabled(options, value))
          setOpen(true)
        }
        break
      case 'Home':
      case 'End':
        event.preventDefault()
        setActiveIndex(event.key === 'Home' ? firstEnabled(options) : lastEnabled(options))
        setOpen(true)
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        if (open) choose(activeIndex)
        else {
          setActiveIndex(selectedEnabled(options, value))
          setOpen(true)
        }
        break
      case 'Escape':
        if (open) {
          event.preventDefault()
          event.stopPropagation()
          setOpen(false)
        }
        break
      case 'Tab':
        setOpen(false)
        break
      default:
        if (event.key.length !== 1 || event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) break
        {
          const character = event.key.toLocaleLowerCase()
          const now = Date.now()
          const previous = typeaheadRef.current
          let query = now - previous.at < 700 ? previous.query + character : character
          const findMatch = (prefix: string) => {
            const start = open ? activeIndex : selectedEnabled(options, value)
            for (let step = 1; step <= options.length; step += 1) {
              const index = (start + step + options.length) % options.length
              if (!options[index].disabled && options[index].label.toLocaleLowerCase().startsWith(prefix)) return index
            }
            return -1
          }
          let match = findMatch(query)
          if (match < 0) {
            query = character
            match = findMatch(query)
          }
          typeaheadRef.current = { query, at: now }
          if (match < 0) break
          event.preventDefault()
          setActiveIndex(match)
          setOpen(true)
        }
        break
    }
  }

  return (
    <div className={['mg-dropdown', className].filter(Boolean).join(' ')}>
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        aria-label={accessibleName}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
        className="mg-dropdown__trigger"
        title={title}
        disabled={disabled}
        onClick={() => {
          if (!open) setActiveIndex(selectedEnabled(options, value))
          setOpen((wasOpen) => !wasOpen)
        }}
        onKeyDown={handleKeyDown}
      >
        <span className="mg-dropdown__value">{selectedLabel}</span>
        <ChevronDown size={15} strokeWidth={2} aria-hidden="true" className="mg-dropdown__chevron" />
      </button>
      {open && position && createPortal(
        <div
          ref={menuRef}
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel ?? title ?? selectedLabel}
          className="mg-dropdown__menu"
          style={position}
        >
          {options.map((option, index) => (
            <div
              key={`${option.value}-${index}`}
              id={`${listboxId}-option-${index}`}
              role="option"
              aria-selected={option.value === value}
              aria-disabled={option.disabled || undefined}
              className={[
                'mg-dropdown__option',
                index === activeIndex && 'is-active',
                option.value === value && 'is-selected',
                option.disabled && 'is-disabled',
              ].filter(Boolean).join(' ')}
              onMouseEnter={() => { if (!option.disabled) setActiveIndex(index) }}
              onPointerDown={(event) => { if (event.pointerType === 'mouse') event.preventDefault() }}
              onClick={() => choose(index)}
            >
              {option.label}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}
