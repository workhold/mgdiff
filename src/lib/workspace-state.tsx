import { createContext, useCallback, useContext, useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'

export type WorkspaceValues = Record<string, unknown>

type WorkspaceStateContextValue = {
  values: WorkspaceValues
  onChange: (key: string, value: unknown) => void
}

const WorkspaceStateContext = createContext<WorkspaceStateContextValue | null>(null)

export function WorkspaceStateProvider({ values, onChange, children }: WorkspaceStateContextValue & { children: ReactNode }) {
  return <WorkspaceStateContext.Provider value={{ values, onChange }}>{children}</WorkspaceStateContext.Provider>
}

/** State owned by one tab and saved whenever its value changes. */
export function useWorkspaceState<T>(key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const context = useContext(WorkspaceStateContext)
  if (!context) throw new Error('useWorkspaceState must be used within WorkspaceStateProvider')
  const [value, setValue] = useState<T>(() => Object.hasOwn(context.values, key)
    ? context.values[key] as T
    : typeof initial === 'function' ? (initial as () => T)() : initial)
  const valueRef = useRef(value)
  valueRef.current = value
  const onChangeRef = useRef(context.onChange)
  onChangeRef.current = context.onChange
  useEffect(() => {
    if (!Object.hasOwn(context.values, key)) onChangeRef.current(key, valueRef.current)
    // Seeds supplied by external tools and history become part of the tab snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const update = useCallback<Dispatch<SetStateAction<T>>>((action) => {
    const next = typeof action === 'function' ? (action as (previous: T) => T)(valueRef.current) : action
    if (Object.is(next, valueRef.current)) return
    valueRef.current = next
    setValue(next)
    onChangeRef.current(key, next)
  }, [key])
  return [value, update]
}
