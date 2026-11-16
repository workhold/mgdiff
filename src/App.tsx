import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import {
  Clock3, Command, FileImage, FileSpreadsheet, FileText,
  FolderClosed, GitBranch, GitMerge, HelpCircle, Layers3, LockKeyhole, PanelLeftClose, PanelLeftOpen, Plus, Wrench, X,
} from 'lucide-react'
import TextCompare, { type TextPair } from './components/TextCompare'
import TableCompare from './components/TableCompare'
import ImageCompare from './components/ImageCompare'
import FolderCompare from './components/FolderCompare'
import PdfCompare from './components/PdfCompare'
import HistoryPanel from './components/HistoryPanel'
import IntegrationPanel from './components/IntegrationPanel'
import MergeWorkspace, { type MergeInputs } from './components/MergeWorkspace'
import DeveloperToolbox from './components/DeveloperToolbox'
import Dropdown from './components/Dropdown'
import { recordHistory, type HistoryRecordInput, type HistoryReplayPayload } from './lib/history'
import { ExternalLaunchError, getExternalLaunch, isExternalLaunch, saveExternalMerge, type ExternalFolderSelection } from './lib/external-launch'
import { isTauriApp } from './lib/files'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useLanguage } from './i18n'
import { WorkspaceStateProvider, type WorkspaceValues } from './lib/workspace-state'
import { flushWorkspaceSession, loadWorkspaceSession, saveWorkspaceSession, type SessionMode, type WorkspaceSession } from './lib/workspace-session'
import packageJson from '../package.json'

type CompareMode = 'text' | 'table' | 'image' | 'folder' | 'pdf'
type Mode = CompareMode | 'merge' | 'toolbox'
type FilePair = { leftFile: File; rightFile: File }
type FolderPair = { left: ExternalFolderSelection; right: ExternalFolderSelection }
type LaunchSeed =
  | { mode: 'text'; pair: TextPair; recordAuto: boolean }
  | { mode: 'table' | 'image' | 'pdf'; files: FilePair; recordAuto: boolean }
  | { mode: 'folder'; folders: FolderPair; recordAuto: boolean }

type WorkspaceTab = { id: number; mode: Mode; fileName?: string; seed?: LaunchSeed; state: WorkspaceValues }
type TabMenu = { tabId: number; x: number; y: number }
type TabDrop = { targetId: number; side: 'before' | 'after' }

const modeIds: CompareMode[] = ['text', 'table', 'image', 'folder', 'pdf']

export default function App() {
  const { language, setLanguage, tr } = useLanguage()
  const modes = [
    { id: 'text' as CompareMode, title: tr('文本对比', 'Text comparison'), description: tr('逐行查看代码与文本的变化', 'Review changes in code and text line by line'), icon: FileText, shortcut: '1' },
    { id: 'table' as CompareMode, title: tr('表格对比', 'Spreadsheet comparison'), description: tr('定位工作表和单元格差异', 'Find worksheet and cell differences'), icon: FileSpreadsheet, shortcut: '2' },
    { id: 'image' as CompareMode, title: tr('图片对比', 'Image comparison'), description: tr('叠加、滑动和像素差异', 'Overlay, swipe, and inspect pixel differences'), icon: FileImage, shortcut: '3' },
    { id: 'folder' as CompareMode, title: tr('文件夹对比', 'Folder comparison'), description: tr('递归核对目录中的文件', 'Compare files across folders recursively'), icon: FolderClosed, shortcut: '4' },
    { id: 'pdf' as CompareMode, title: tr('PDF 对比', 'PDF comparison'), description: tr('逐页检查视觉与文字变化', 'Inspect visual and text changes page by page'), icon: FileText, shortcut: '5' },
  ]
  const [tabs, setTabs] = useState<WorkspaceTab[]>([{ id: 1, mode: 'text', state: {} }])
  const [activeTabId, setActiveTabId] = useState<number | null>(1)
  const [restoring, setRestoring] = useState(true)
  const tabCounter = useRef(1)
  const lastMode = useRef<Mode>('text')
  const externalLaunchRef = useRef(false)
  const tabsRef = useRef(tabs)
  const activeTabIdRef = useRef(activeTabId)
  const sidebarOpenRef = useRef(true)
  const tabRefs = useRef(new Map<number, HTMLButtonElement>())
  const addTabRef = useRef<HTMLButtonElement>(null)
  const tabListRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const pointerDrag = useRef<{ id: number; pointerId: number; startX: number; startY: number; started: boolean } | null>(null)
  const suppressTabClick = useRef<{ id: number; until: number } | null>(null)
  const [draggedTabId, setDraggedTabId] = useState<number | null>(null)
  const [tabDrop, setTabDrop] = useState<TabDrop | null>(null)
  const [tabMenu, setTabMenu] = useState<TabMenu | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [helpOpen, setHelpOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [integrationOpen, setIntegrationOpen] = useState(false)
  const [externalMerge, setExternalMerge] = useState<MergeInputs | null>(null)
  const [launchError, setLaunchError] = useState<{ zh: string; en: string } | null>(null)
  tabsRef.current = tabs
  activeTabIdRef.current = activeTabId
  sidebarOpenRef.current = sidebarOpen
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null
  const mode = activeTab?.mode ?? lastMode.current
  const modeOptions = [
    ...modes.map((item) => ({ value: item.id, label: item.title })),
    { value: 'toolbox', label: tr('开发工具箱', 'Developer toolbox') },
    ...(externalMerge ? [{ value: 'merge', label: tr('Git 三方合并', 'Git three-way merge') }] : []),
  ]
  function modeTitle(nextMode: Mode) { return nextMode === 'merge'
    ? tr('Git 三方合并', 'Git three-way merge')
    : nextMode === 'toolbox'
      ? tr('开发工具箱', 'Developer toolbox')
      : modes.find((item) => item.id === nextMode)?.title ?? modes[0].title
  }

  function createTab(nextMode: Mode, seed?: LaunchSeed, fileName?: string) {
    const id = ++tabCounter.current
    setTabs((previous) => [...previous, { id, mode: nextMode, seed, fileName, state: {} }])
    lastMode.current = nextMode
    setActiveTabId(id)
  }

  function selectMode(nextMode: Mode) {
    const latest = tabs.reduce<WorkspaceTab | null>((found, tab) =>
      tab.mode === nextMode && (!found || tab.id > found.id) ? tab : found, null)
    if (latest) {
      lastMode.current = nextMode
      setActiveTabId(latest.id)
    } else if (nextMode !== 'merge' || externalMerge) {
      createTab(nextMode, undefined, nextMode === 'merge' ? externalMerge?.mergedName : undefined)
    }
  }

  function closeTab(id: number) {
    setTabMenu(null)
    const index = tabs.findIndex((tab) => tab.id === id)
    if (index < 0) return
    const remaining = tabs.filter((tab) => tab.id !== id)
    setTabs(remaining)
    tabRefs.current.delete(id)
    if (activeTabId === id) {
      const fallback = remaining[index - 1] ?? remaining[index] ?? null
      if (fallback) lastMode.current = fallback.mode
      setActiveTabId(fallback?.id ?? null)
    }
    const focusId = activeTabId === id ? (remaining[index - 1] ?? remaining[index])?.id : activeTabId
    requestAnimationFrame(() => {
      const target = tabRefs.current.get(focusId ?? -1)
      if (target) target.focus()
      else addTabRef.current?.focus()
    })
  }

  function closeAllTabs() {
    if (tabMenu) {
      const contextTab = tabs.find((tab) => tab.id === tabMenu.tabId)
      if (contextTab) lastMode.current = contextTab.mode
    }
    setTabs([])
    setActiveTabId(null)
    tabRefs.current.clear()
    setTabMenu(null)
    requestAnimationFrame(() => addTabRef.current?.focus())
  }

  function closeTabsToRight(id: number) {
    const index = tabs.findIndex((tab) => tab.id === id)
    if (index < 0) return
    const remaining = tabs.slice(0, index + 1)
    const removed = tabs.slice(index + 1)
    removed.forEach((tab) => tabRefs.current.delete(tab.id))
    setTabs(remaining)
    const nextActive = remaining.find((tab) => tab.id === activeTabId)
      ?? remaining[index]
    lastMode.current = nextActive.mode
    setActiveTabId(nextActive.id)
    setTabMenu(null)
    requestAnimationFrame(() => tabRefs.current.get(nextActive.id)?.focus())
  }

  function openTabMenu(id: number, x: number, y: number) {
    const menuWidth = 190
    const menuHeight = 132
    setTabMenu({
      tabId: id,
      x: Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - menuHeight - 8)),
    })
  }

  function onTabContextMenu(event: ReactMouseEvent<HTMLDivElement>, id: number) {
    event.preventDefault()
    openTabMenu(id, event.clientX, event.clientY)
  }

  function onTabMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Tab') {
      setTabMenu(null)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      const id = tabMenu?.tabId
      setTabMenu(null)
      requestAnimationFrame(() => tabRefs.current.get(id ?? -1)?.focus())
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
    if (items.length === 0) return
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : event.key === 'ArrowDown' ? (current + 1) % items.length
        : (current - 1 + items.length) % items.length
    items[next].focus()
  }

  function clearTabDrag() {
    pointerDrag.current = null
    setDraggedTabId(null)
    setTabDrop(null)
  }

  function tabDropAt(sourceId: number, x: number): TabDrop | null {
    const others = tabs.filter((tab) => tab.id !== sourceId)
    if (others.length === 0) return null
    const before = others.find((tab) => {
      const rect = tabRefs.current.get(tab.id)?.getBoundingClientRect()
      return rect && x < rect.left + rect.width / 2
    })
    return before ? { targetId: before.id, side: 'before' }
      : { targetId: others[others.length - 1].id, side: 'after' }
  }

  function pointerIsInTabList(x: number, y: number) {
    const list = tabListRef.current
    if (!list) return false
    const rect = list.getBoundingClientRect()
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  }

  function onTabPointerDown(event: ReactPointerEvent<HTMLButtonElement>, id: number) {
    if (event.button !== 0 || event.pointerType === 'touch') return
    pointerDrag.current = { id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, started: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onTabMouseDown(event: ReactMouseEvent<HTMLButtonElement>, id: number) {
    if (event.button !== 0 || pointerDrag.current) return
    pointerDrag.current = { id, pointerId: -1, startX: event.clientX, startY: event.clientY, started: false }
  }

  function updateTabDrag(x: number, y: number) {
    const drag = pointerDrag.current
    if (!drag) return
    if (!drag.started) {
      if (Math.hypot(x - drag.startX, y - drag.startY) < 6) return
      drag.started = true
      setDraggedTabId(drag.id)
      setTabMenu(null)
    }
    const list = tabListRef.current
    if (!list || !pointerIsInTabList(x, y)) {
      setTabDrop(null)
      return
    }
    const rect = list.getBoundingClientRect()
    if (x < rect.left + 35) list.scrollLeft -= 18
    else if (x > rect.right - 35) list.scrollLeft += 18
    const drop = tabDropAt(drag.id, x)
    setTabDrop((current) => current?.targetId === drop?.targetId && current?.side === drop?.side ? current : drop)
  }

  function finishTabDrag(x: number, y: number) {
    const drag = pointerDrag.current
    if (!drag) return
    if (!drag.started && Math.hypot(x - drag.startX, y - drag.startY) >= 6) drag.started = true
    if (drag.started) {
      suppressTabClick.current = { id: drag.id, until: Date.now() + 350 }
      const drop = pointerIsInTabList(x, y) ? tabDropAt(drag.id, x) : null
      if (drop) {
        setTabs((previous) => {
          const source = previous.find((tab) => tab.id === drag.id)
          if (!source) return previous
          const ordered = previous.filter((tab) => tab.id !== drag.id)
          const targetIndex = ordered.findIndex((tab) => tab.id === drop.targetId)
          if (targetIndex < 0) return previous
          ordered.splice(targetIndex + (drop.side === 'after' ? 1 : 0), 0, source)
          return ordered
        })
      }
    }
    clearTabDrag()
  }

  function onTabPointerMove(event: ReactPointerEvent<HTMLButtonElement>, id: number) {
    const drag = pointerDrag.current
    if (!drag || drag.id !== id || drag.pointerId !== event.pointerId) return
    updateTabDrag(event.clientX, event.clientY)
  }

  function onTabPointerUp(event: ReactPointerEvent<HTMLButtonElement>, id: number) {
    const drag = pointerDrag.current
    if (!drag || drag.id !== id || drag.pointerId !== event.pointerId) return
    finishTabDrag(event.clientX, event.clientY)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function moveTabWithKeyboard(id: number, direction: -1 | 1) {
    setTabs((previous) => {
      const index = previous.findIndex((tab) => tab.id === id)
      const next = index + direction
      if (index < 0 || next < 0 || next >= previous.length) return previous
      const ordered = [...previous]
      ;[ordered[index], ordered[next]] = [ordered[next], ordered[index]]
      return ordered
    })
    requestAnimationFrame(() => tabRefs.current.get(id)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }))
  }

  function updateTabFileName(id: number, fileName: string | null) {
    const normalized = fileName?.trim() || undefined
    setTabs((previous) => {
      if (previous.find((tab) => tab.id === id)?.fileName === normalized) return previous
      return previous.map((tab) => tab.id === id ? { ...tab, fileName: normalized } : tab)
    })
  }

  function sessionSnapshot(currentTabs = tabsRef.current): WorkspaceSession {
    const sessionTabs = currentTabs.filter((tab): tab is WorkspaceTab & { mode: SessionMode } => tab.mode !== 'merge')
      .map(({ id, mode, fileName, state }) => ({ id, mode, fileName, state }))
    const active = activeTabIdRef.current
    return {
      tabs: sessionTabs,
      activeTabId: sessionTabs.some((tab) => tab.id === active) ? active : sessionTabs.at(-1)?.id ?? null,
      nextId: tabCounter.current,
      lastMode: lastMode.current === 'merge' ? sessionTabs.at(-1)?.mode ?? 'text' : lastMode.current,
      sidebarOpen: sidebarOpenRef.current,
    }
  }

  function saveCurrentSession(currentTabs = tabsRef.current) {
    if (restoring || externalLaunchRef.current) return
    saveWorkspaceSession(sessionSnapshot(currentTabs))
  }

  function updateTabState(id: number, key: string, value: unknown) {
    const current = tabsRef.current
    const tab = current.find((item) => item.id === id)
    if (!tab || Object.is(tab.state[key], value)) return
    const next = current.map((item) => item.id === id ? { ...item, state: { ...item.state, [key]: value } } : item)
    tabsRef.current = next
    setTabs(next)
    saveCurrentSession(next)
  }

  useEffect(() => {
    let cancelled = false
    void isExternalLaunch().then((external) => {
      if (cancelled) return
      if (external) {
        externalLaunchRef.current = true
        tabsRef.current = []
        activeTabIdRef.current = null
        tabCounter.current = 0
        setTabs([])
        setActiveTabId(null)
        setRestoring(false)
        return
      }
      void loadWorkspaceSession().then(({ session, missingFiles }) => {
        if (cancelled) return
        if (session) {
          const restored = session.tabs.map((tab) => ({ ...tab, state: tab.state }))
          tabsRef.current = restored
          setTabs(restored)
          activeTabIdRef.current = session.activeTabId
          setActiveTabId(session.activeTabId)
          tabCounter.current = session.nextId
          lastMode.current = session.lastMode
          sidebarOpenRef.current = session.sidebarOpen
          setSidebarOpen(session.sidebarOpen)
        }
        if (missingFiles) setLaunchError({ zh: '部分文件无法从本机存储恢复，请重新选择。', en: 'Some files could not be restored from local storage. Select them again.' })
        setRestoring(false)
      }).catch(() => { if (!cancelled) setRestoring(false) })
    }).catch(() => {
      if (cancelled) return
      // An unknown launch mode must not overwrite another window's workspace.
      externalLaunchRef.current = true
      tabsRef.current = []
      activeTabIdRef.current = null
      tabCounter.current = 0
      setTabs([])
      setActiveTabId(null)
      setLaunchError({ zh: '无法确认启动方式，当前窗口不会保存工作区。', en: 'Unable to determine the launch mode. This window will not save the workspace.' })
      setRestoring(false)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (restoring) return
    saveCurrentSession()
  }, [tabs, activeTabId, sidebarOpen, restoring])

  useEffect(() => {
    if (restoring) return
    const flush = () => saveCurrentSession()
    const reportError = () => setLaunchError({ zh: '本机存储不可用，工作区未能完整保存。', en: 'Local storage is unavailable. The workspace could not be saved completely.' })
    window.addEventListener('pagehide', flush)
    window.addEventListener('mgdiff:workspace-save-error', reportError)
    return () => {
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('mgdiff:workspace-save-error', reportError)
    }
  }, [restoring])

  useEffect(() => {
    if (restoring || externalLaunchRef.current || !isTauriApp()) return
    let disposed = false
    let unlisten: (() => void) | undefined
    void getCurrentWindow().onCloseRequested(async (event) => {
      saveCurrentSession()
      let saved = false
      try { saved = await flushWorkspaceSession() } catch { /* Keep the window open so the user can retry. */ }
      if (!saved) {
        event.preventDefault()
        setLaunchError({ zh: '工作区未能完整保存，请重试关闭。', en: 'The workspace could not be saved completely. Retry closing the window.' })
      }
    }).then((remove) => {
      if (disposed) remove()
      else unlisten = remove
    }).catch(() => {
      if (!disposed) setLaunchError({ zh: '无法监听窗口关闭，工作区可能无法完整保存。', en: 'Unable to monitor window closing. The workspace may not be saved completely.' })
    })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [restoring])

  function tabTitle(tab: WorkspaceTab) {
    return `${modeTitle(tab.mode)} · ${tab.fileName ?? `#${tab.id}`}`
  }

  function onTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    const tab = tabs[index]
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault()
      const rect = event.currentTarget.getBoundingClientRect()
      openTabMenu(tab.id, rect.left, rect.bottom + 4)
      return
    }
    if (event.altKey && event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault()
      moveTabWithKeyboard(tab.id, event.key === 'ArrowLeft' ? -1 : 1)
      return
    }
    let nextIndex: number
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = tabs.length - 1
    else return
    event.preventDefault()
    const next = tabs[nextIndex]
    lastMode.current = next.mode
    setActiveTabId(next.id)
    tabRefs.current.get(next.id)?.focus()
  }

  useEffect(() => {
    tabRefs.current.get(activeTabId ?? -1)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeTabId, tabs.length])

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => updateTabDrag(event.clientX, event.clientY)
    const onMouseUp = (event: MouseEvent) => finishTabDrag(event.clientX, event.clientY)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    window.addEventListener('blur', clearTabDrag)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('blur', clearTabDrag)
    }
  }, [tabs])

  useEffect(() => {
    if (!tabMenu) return
    requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus())
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setTabMenu(null)
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setTabMenu(null)
      requestAnimationFrame(() => tabRefs.current.get(tabMenu.tabId)?.focus())
    }
    const dismiss = () => setTabMenu(null)
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onEscape)
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismiss, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onEscape)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismiss, true)
    }
  }, [tabMenu])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setHelpOpen(false); setHistoryOpen(false); setIntegrationOpen(false) }
      if ((event.metaKey || event.ctrlKey) && /^[1-5]$/.test(event.key)) {
        event.preventDefault()
        selectMode(modeIds[Number(event.key) - 1])
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [tabs, externalMerge])

  function openTextPair(pair: TextPair) {
    createTab('text', { mode: 'text', pair, recordAuto: false }, pair.leftUntitled ? pair.rightName : pair.leftName)
  }

  function onCompared(record: HistoryRecordInput) {
    void recordHistory(record).then((saved) => {
      if (!saved) setLaunchError({ zh: '本机存储不可用，这次对比未写入历史。', en: 'Local storage is unavailable. This comparison was not saved to history.' })
    }).catch(() => setLaunchError({ zh: '本机存储不可用，这次对比未写入历史。', en: 'Local storage is unavailable. This comparison was not saved to history.' }))
  }

  function replayHistory(payload: HistoryReplayPayload) {
    if (payload.mode === 'text') {
      createTab('text', { mode: 'text', pair: payload, recordAuto: false }, payload.leftUntitled ? (payload.rightUntitled ? undefined : payload.rightName) : payload.leftName)
    } else {
      createTab(payload.mode, { mode: payload.mode, files: { leftFile: payload.leftFile, rightFile: payload.rightFile }, recordAuto: false }, payload.leftFile.name)
    }
  }

  useEffect(() => {
    if (restoring) return
    let cancelled = false
    void getExternalLaunch().then((launch) => {
      if (cancelled || !launch) return
      if (launch.kind === 'merge') {
        setExternalMerge(launch)
        createTab('merge', undefined, launch.mergedName)
        return
      }
      if (launch.kind === 'diff-directory') {
        createTab('folder', { mode: 'folder', folders: { left: launch.left, right: launch.right }, recordAuto: true }, launch.left.folderPath.split(/[\\/]/).filter(Boolean).at(-1))
      } else if (launch.mode === 'text') {
        void Promise.all([launch.left.text(), launch.right.text()]).then(([leftText, rightText]) => {
          if (!cancelled) createTab('text', { mode: 'text', pair: { leftName: launch.left.name, rightName: launch.right.name, leftText, rightText }, recordAuto: true }, launch.left.name)
        }).catch(() => { if (!cancelled) setLaunchError({ zh: '无法读取外部文本文件', en: 'Unable to read the text file from the external tool.' }) })
      } else {
        createTab(launch.mode, { mode: launch.mode, files: { leftFile: launch.left, rightFile: launch.right }, recordAuto: true }, launch.left.name)
      }
    }).catch((cause) => { if (!cancelled) setLaunchError(cause instanceof ExternalLaunchError
      ? { zh: cause.message, en: cause.english }
      : { zh: '外部工具启动失败', en: 'Unable to launch from the external tool.' }) })
    return () => { cancelled = true }
  }, [restoring])

  async function saveMergeResult(text: string) {
    await saveExternalMerge(text)
    try {
      await getCurrentWindow().close()
    } catch {
      throw new Error(tr('合并结果已写入；请手动关闭窗口以完成合并。', 'The merged result was saved. Close this window to finish the merge.'))
    }
  }

  function cancelMerge() {
    void getCurrentWindow().close()
  }

  if (restoring) return <div className="app-shell" />

  return (
    <div className={`app-shell ${sidebarOpen ? '' : 'sidebar-collapsed'}`}>
      <header className="app-topbar" data-tauri-drag-region>
        <div className="brand" data-tauri-drag-region>
          <button className="sidebar-toggle" type="button" aria-label={sidebarOpen ? tr('收起侧边栏', 'Collapse sidebar') : tr('展开侧边栏', 'Expand sidebar')} onClick={() => setSidebarOpen(!sidebarOpen)}>{sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}</button>
          <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>
          <span className="brand-name">MG Diff</span>
          <span className="brand-divider" />
          <span className="brand-subtitle">{tr('文件对比工作台', 'File comparison workspace')}</span>
        </div>
        <div className="topbar-right">
          <span className="offline-badge"><span /> {tr('离线工作', 'Works offline')}</span>
          <button className="topbar-help" type="button" aria-label={tr('对比历史', 'History')} onClick={() => setHistoryOpen(true)}><Clock3 size={17} /><span>{tr('对比历史', 'History')}</span></button>
          <button className="topbar-help" type="button" aria-label={tr('工具集成', 'Integrations')} onClick={() => setIntegrationOpen(true)}><GitBranch size={17} /><span>{tr('工具集成', 'Integrations')}</span></button>
          <button className="topbar-help" type="button" aria-label={tr('使用指南', 'Help')} onClick={() => setHelpOpen(true)}><HelpCircle size={17} /><span>{tr('使用指南', 'Help')}</span></button>
          <div className="language-switch" role="group" aria-label={tr('界面语言', 'Interface language')}>
            <button type="button" lang="zh-CN" aria-label={tr('切换为中文', 'Switch to Chinese')} aria-pressed={language === 'zh-CN'} onClick={() => setLanguage('zh-CN')}>中</button>
            <button type="button" lang="en" aria-label={tr('切换为英文', 'Switch to English')} aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>EN</button>
          </div>
        </div>
      </header>

      <aside className="app-sidebar" aria-label={tr('对比类型导航', 'Comparison type navigation')}>
        <div className="sidebar-section-label">{tr('工作区', 'Workspace')} <Layers3 size={14} /></div>
        <div className="sidebar-intro">{tr('选择需要比较的文件类型', 'Choose the type of files to compare')}</div>
        <nav className="mode-nav">
          {modes.map((item) => {
            const Icon = item.icon
            return <button key={item.id} type="button" className={`mode-nav-item ${mode === item.id && activeTab ? 'active' : ''}`} onClick={() => selectMode(item.id)} title={item.title}>
              <span className="mode-nav-icon"><Icon size={18} strokeWidth={1.9} /></span>
              <span className="mode-nav-copy"><strong>{item.title}</strong><small>{item.description}</small></span>
              <span className="mode-nav-shortcut">{item.shortcut}</span>
            </button>
          })}
          {externalMerge && <button type="button" className={`mode-nav-item ${mode === 'merge' && activeTab ? 'active' : ''}`} onClick={() => selectMode('merge')} title={tr('Git 三方合并', 'Git three-way merge')}><span className="mode-nav-icon"><GitMerge size={18} /></span><span className="mode-nav-copy"><strong>{tr('Git 三方合并', 'Git three-way merge')}</strong><small>{tr('解决冲突并写回结果', 'Resolve conflicts and save the result')}</small></span></button>}
        </nav>
        <div className="sidebar-section-label sidebar-section-label--tools">{tr('开发工具', 'Developer tools')} <Wrench size={14} /></div>
        <nav className="mode-nav" aria-label={tr('开发工具导航', 'Developer tools navigation')}>
          <button type="button" className={`mode-nav-item ${mode === 'toolbox' && activeTab ? 'active' : ''}`} onClick={() => selectMode('toolbox')} title={tr('开发工具箱', 'Developer toolbox')}>
            <span className="mode-nav-icon"><Wrench size={18} strokeWidth={1.9} /></span>
            <span className="mode-nav-copy"><strong>{tr('开发工具箱', 'Developer toolbox')}</strong><small>{tr('JSON、时间、IP、编码等', 'JSON, time, IP, encoding, and more')}</small></span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-card"><span className="privacy-icon"><LockKeyhole size={17} /></span><strong>{tr('本地处理，安心对比', 'Private, local comparison')}</strong><p>{tr('文件只在你的设备上读取和分析，不上传到服务器。', 'Files are read and analyzed only on your device. Nothing is uploaded to a server.')}</p></div>
          <div className="sidebar-version"><span>MG Diff</span><span>v{packageJson.version}</span></div>
        </div>
      </aside>

      <main className="main-area">
        <div className="workspace-tabs">
          <div ref={tabListRef} className="workspace-tabs__list" role="tablist" aria-label={tr('打开的页面', 'Open pages')}>
            {tabs.map((tab, index) => {
              const title = tabTitle(tab)
              return <div className={`workspace-tab ${tab.id === activeTabId ? 'active' : ''} ${draggedTabId === tab.id ? 'is-dragging' : ''} ${tabDrop?.targetId === tab.id ? `drop-${tabDrop.side}` : ''}`} key={tab.id} onContextMenu={(event) => onTabContextMenu(event, tab.id)}>
                <button
                  ref={(element) => { if (element) tabRefs.current.set(tab.id, element); else tabRefs.current.delete(tab.id) }}
                  id={`workspace-tab-${tab.id}`}
                  className="workspace-tab__select"
                  type="button"
                  role="tab"
                  aria-selected={tab.id === activeTabId}
                  aria-controls={`workspace-panel-${tab.id}`}
                  tabIndex={tab.id === activeTabId ? 0 : -1}
                  title={title}
                  aria-keyshortcuts="Shift+F10 Alt+Shift+ArrowLeft Alt+Shift+ArrowRight"
                  onClick={() => { if (suppressTabClick.current?.id === tab.id && Date.now() < suppressTabClick.current.until) { suppressTabClick.current = null; return }; lastMode.current = tab.mode; setActiveTabId(tab.id) }}
                  onKeyDown={(event) => onTabKeyDown(event, index)}
                  onMouseDown={(event) => onTabMouseDown(event, tab.id)}
                  onPointerDown={(event) => onTabPointerDown(event, tab.id)}
                  onPointerMove={(event) => onTabPointerMove(event, tab.id)}
                  onPointerUp={(event) => onTabPointerUp(event, tab.id)}
                  onPointerCancel={clearTabDrag}
                >{title}</button>
                <button className="workspace-tab__close" type="button" aria-label={tr(`关闭 ${title}`, `Close ${title}`)} title={tr('关闭页面', 'Close page')} onClick={() => closeTab(tab.id)}><X size={14} /></button>
              </div>
            })}
          </div>
          <button ref={addTabRef} className="workspace-tab-add" type="button" aria-label={tr('新建同类型页面', 'Open a new page of this type')} title={tr('新建同类型页面', 'Open a new page of this type')} onClick={() => createTab(mode, undefined, mode === 'merge' ? externalMerge?.mergedName : undefined)}><Plus size={18} /></button>
          <div className="mobile-mode-picker"><Dropdown value={mode} options={modeOptions} onChange={(value) => selectMode(value as Mode)} ariaLabel={tr('切换工作区', 'Switch workspace')} /></div>
        </div>
        {tabs.map((tab) => {
          return <div key={tab.id} id={`workspace-panel-${tab.id}`} className="main-scroll" role="tabpanel" aria-labelledby={`workspace-tab-${tab.id}`} hidden={tab.id !== activeTabId}>
          <WorkspaceStateProvider values={tab.state} onChange={(key, value) => updateTabState(tab.id, key, value)}><div className="main-inner">
            <h1 className="visually-hidden">{modeTitle(tab.mode)}</h1>
            {launchError && <div className="inline-error" role="alert">{tr(launchError.zh, launchError.en)} <button className="text-button" type="button" onClick={() => setLaunchError(null)}>{tr('关闭', 'Close')}</button></div>}
            {tab.mode === 'text' && <TextCompare initialPair={tab.seed?.mode === 'text' ? tab.seed.pair : undefined} autoCompare={tab.seed?.mode === 'text'} recordAutoCompare={tab.seed?.mode === 'text' ? tab.seed.recordAuto : false} onCompared={onCompared} onFileNameChange={(name) => updateTabFileName(tab.id, name)} />}
            {tab.mode === 'table' && <TableCompare initialFiles={tab.seed?.mode === 'table' ? tab.seed.files : undefined} autoCompare={tab.seed?.mode === 'table'} recordAutoCompare={tab.seed?.mode === 'table' ? tab.seed.recordAuto : false} onCompared={onCompared} onFileNameChange={(name) => updateTabFileName(tab.id, name)} />}
            {tab.mode === 'image' && <ImageCompare initialFiles={tab.seed?.mode === 'image' ? tab.seed.files : undefined} autoCompare={tab.seed?.mode === 'image'} recordAutoCompare={tab.seed?.mode === 'image' ? tab.seed.recordAuto : false} onCompared={onCompared} onFileNameChange={(name) => updateTabFileName(tab.id, name)} active={tab.id === activeTabId} />}
            {tab.mode === 'folder' && <FolderCompare initialFolderSelections={tab.seed?.mode === 'folder' ? tab.seed.folders : undefined} autoCompare={tab.seed?.mode === 'folder'} recordAutoCompare={tab.seed?.mode === 'folder' ? tab.seed.recordAuto : false} onOpenTextPair={openTextPair} onCompared={onCompared} onFileNameChange={(name) => updateTabFileName(tab.id, name)} />}
            {tab.mode === 'pdf' && <PdfCompare initialFiles={tab.seed?.mode === 'pdf' ? tab.seed.files : undefined} autoCompare={tab.seed?.mode === 'pdf'} recordAutoCompare={tab.seed?.mode === 'pdf' ? tab.seed.recordAuto : false} onCompared={onCompared} onFileNameChange={(name) => updateTabFileName(tab.id, name)} />}
            {tab.mode === 'toolbox' && <DeveloperToolbox />}
            {tab.mode === 'merge' && externalMerge && <MergeWorkspace inputs={externalMerge} onSave={saveMergeResult} onCancel={cancelMerge} />}
            <footer className="app-footer"><span>{tr('MG Diff · 为清晰地发现每一处变化而设计', 'MG Diff · See every change clearly')}</span><span>{tr('所有对比均在本地完成', 'All comparisons stay on your device')}</span></footer>
          </div></WorkspaceStateProvider>
        </div>})}
        {tabs.length === 0 && <div className="main-scroll"><div className="main-inner empty-workspace"><div className="empty-workspace__message"><Layers3 size={32} /><h1>{tr('还没有打开的页面', 'No open pages')}</h1><p>{tr('从左侧选择对比或工具类型，或点击上方 + 新建页面。', 'Choose a comparison or tool from the sidebar, or click + above to open a page.')}</p></div></div></div>}
      </main>

      {tabMenu && <div ref={menuRef} className="tab-context-menu" role="menu" aria-label={tr('页面操作', 'Page actions')} style={{ left: tabMenu.x, top: tabMenu.y }} onKeyDown={onTabMenuKeyDown} onContextMenu={(event) => event.preventDefault()}>
        <button type="button" role="menuitem" onClick={() => closeTab(tabMenu.tabId)}>{tr('关闭', 'Close')}</button>
        <button type="button" role="menuitem" onClick={closeAllTabs}>{tr('关闭所有', 'Close all')}</button>
        <button type="button" role="menuitem" disabled={tabs.findIndex((tab) => tab.id === tabMenu.tabId) === tabs.length - 1} onClick={() => closeTabsToRight(tabMenu.tabId)}>{tr('关闭右侧标签页', 'Close tabs to the right')}</button>
      </div>}

      {helpOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setHelpOpen(false) }}><div className="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title"><div className="help-dialog__head"><div><span className="eyebrow">{tr('快速上手', 'Quick start')}</span><h2 id="help-title">{tr('使用指南', 'Help')}</h2></div><button className="icon-button" type="button" aria-label={tr('关闭指南', 'Close help')} onClick={() => setHelpOpen(false)}><X size={18} /></button></div><div className="help-steps"><div><span>01</span><strong>{tr('选择工作区', 'Choose a workspace')}</strong><p>{tr('从左侧切换文件对比类型，或打开开发工具箱处理常用数据。', 'Choose a file comparison type or open the developer toolbox from the sidebar.')}</p></div><div><span>02</span><strong>{tr('导入两个版本', 'Import two versions')}</strong><p>{tr('选择本地文件或文件夹；文本还可以直接粘贴和编辑。', 'Select local files or folders. You can also paste and edit text directly.')}</p></div><div><span>03</span><strong>{tr('点击开始比对', 'Start comparing')}</strong><p>{tr('在独立结果页使用筛选、导航和专用视图定位变化。', 'Use filters, navigation, and specialized views to find changes in the results.')}</p></div><div><span>04</span><strong>{tr('重开历史', 'Reopen history')}</strong><p>{tr('顶部“对比历史”可搜索和重开已保存的本机快照。', 'Search and reopen saved local snapshots from History in the top bar.')}</p></div></div><div className="shortcut-hint"><Command size={15} /> {tr('使用', 'Use')} <kbd>⌘ / Ctrl</kbd> + <kbd>1–5</kbd> {tr('快速切换对比类型', 'to switch comparison types quickly')}</div></div></div>}
      {historyOpen && <HistoryPanel onClose={() => setHistoryOpen(false)} onReplay={replayHistory} />}
      {integrationOpen && <IntegrationPanel onClose={() => setIntegrationOpen(false)} />}
    </div>
  )
}
