import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Clock3, FileImage, FileSpreadsheet, FileText, FolderClosed, LockKeyhole,
  RotateCcw, Search, Trash2, X,
} from 'lucide-react'
import {
  clearHistory, getReplayPayload, HISTORY_CHANGED_EVENT, listHistory, removeHistory,
  type HistoryEntry, type HistoryMode, type HistoryReplayPayload,
} from '../lib/history'
import { displayFileName, useLanguage } from '../i18n'
import Dropdown from './Dropdown'
import './history.css'

type Props = {
  onClose: () => void
  onReplay: (payload: HistoryReplayPayload) => void
}

const modeInfo = {
  text: { icon: FileText },
  table: { icon: FileSpreadsheet },
  image: { icon: FileImage },
  folder: { icon: FolderClosed },
  pdf: { icon: FileText },
} as const

type Translate = (zh: string, en: string) => string

function modeLabel(mode: HistoryMode, tr: Translate): string {
  return {
    text: tr('文本', 'Text'), table: tr('表格', 'Table'), image: tr('图片', 'Image'),
    folder: tr('文件夹', 'Folder'), pdf: 'PDF',
  }[mode]
}

function timeLabel(timestamp: number, language: string): string {
  return new Intl.DateTimeFormat(language, {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(timestamp)
}

function localizedSummary(summary: string, tr: Translate): string {
  const text = summary.match(/^(\d+) 处差异$/)
  if (text) return tr(summary, `${text[1]} difference${text[1] === '1' ? '' : 's'}`)
  const table = summary.match(/^(\d+) 个单元格不同$/)
  if (table) return tr(summary, `${table[1]} cell${table[1] === '1' ? '' : 's'} changed`)
  const image = summary.match(/^约 (\d+(?:\.\d+)?)% 像素不同$/)
  if (image) return tr(summary, `About ${image[1]}% of pixels changed`)
  const folder = summary.match(/^(\d+) 个文件不同$/)
  if (folder) return tr(summary, `${folder[1]} file${folder[1] === '1' ? '' : 's'} changed`)
  const pdf = summary.match(/^(\d+) 页不同$/)
  if (pdf) return tr(summary, `${pdf[1]} page${pdf[1] === '1' ? '' : 's'} changed`)
  return summary
}

const legacyReasons: Record<string, string> = {
  '本机存储空间不足，未保存文本快照': 'Not enough local storage to save the text snapshot',
  '文本快照超过本地备用存储上限': 'Text snapshot exceeds the local backup storage limit',
  '本机文件存储不可用，未保存原文件': 'Local file storage is unavailable; original files were not saved',
  '目录内容未保存，请重新选择两个文件夹': 'Folder contents were not saved; choose both folders again',
  '文本超过 2 MB，未保存原文': 'Text exceeds 2 MB; original text was not saved',
  '文件超过快照大小上限，请重新选择原文件': 'Files exceed the snapshot size limit; choose the original files again',
  '本机存储空间不足，只保存了差异摘要': 'Not enough local storage; only the difference summary was saved',
}

function localizedReason(reason: string | undefined, tr: Translate): string {
  if (!reason) return tr('仅保存了差异摘要', 'Only the difference summary was saved')
  return legacyReasons[reason] ? tr(reason, legacyReasons[reason]) : reason
}

function historyName(entry: HistoryEntry, side: 'left' | 'right', tr: Translate): string {
  const name = side === 'left' ? entry.leftName : entry.rightName
  const untitled = side === 'left' ? entry.leftUntitled : entry.rightUntitled
  if (entry.mode === 'text' && (untitled ?? name === '未命名')) return tr('未命名', 'Untitled')
  return displayFileName(name, tr)
}

const historyErrors: Record<string, string> = {
  '读取本地历史失败，请稍后重试': 'Could not load local history. Please try again later.',
  '原始快照已不可用，请重新选择文件': 'The original snapshot is unavailable. Please choose the files again.',
  '无法重开这条记录，请重新选择文件': 'Could not reopen this record. Please choose the files again.',
  '删除失败，请稍后重试': 'Could not delete the record. Please try again later.',
  '清空失败，请稍后重试': 'Could not clear history. Please try again later.',
}

export default function HistoryPanel({ onClose, onReplay }: Props) {
  const { language, tr } = useLanguage()
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [mode, setMode] = useState<HistoryMode | 'all'>('all')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [error, setError] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    try {
      setEntries(await listHistory())
      setError('')
    } catch {
      setError('读取本地历史失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    window.addEventListener(HISTORY_CHANGED_EVENT, refresh)
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    searchRef.current?.focus()
    return () => {
      window.removeEventListener(HISTORY_CHANGED_EVENT, refresh)
      previousFocus?.focus()
    }
  }, [refresh])

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    return entries.filter((entry) => (mode === 'all' || entry.mode === mode) && (
      !query || [entry.leftName, entry.rightName, historyName(entry, 'left', tr), historyName(entry, 'right', tr), entry.summary, localizedSummary(entry.summary, tr), modeLabel(entry.mode, tr)]
        .some((value) => value.toLocaleLowerCase().includes(query))
    ))
  }, [entries, mode, search, tr])

  async function replay(entry: HistoryEntry) {
    setBusyId(entry.id)
    setError('')
    try {
      const payload = await getReplayPayload(entry.id)
      if (!payload) { setError('原始快照已不可用，请重新选择文件'); return }
      onReplay(payload)
      onClose()
    } catch {
      setError('无法重开这条记录，请重新选择文件')
    } finally {
      setBusyId(null)
    }
  }

  async function remove(id: string) {
    setBusyId(id)
    try { await removeHistory(id); await refresh() }
    catch { setError('删除失败，请稍后重试') }
    finally { setBusyId(null) }
  }

  async function clear() {
    setClearing(true)
    try { await clearHistory(); await refresh(); setConfirmClear(false) }
    catch { setError('清空失败，请稍后重试') }
    finally { setClearing(false) }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); return }
    if (event.key !== 'Tab') return
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? [])
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  return (
    <div className="history-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="history-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="history-title" onKeyDown={handleKeyDown}>
        <div className="history-head">
          <div className="history-title"><span className="history-title-icon"><Clock3 size={20} /></span><div><span className="eyebrow">{tr('本机记录', 'Local records')}</span><h2 id="history-title">{tr('对比历史', 'Comparison history')} <small>{entries.length}</small></h2></div></div>
          <button className="history-icon-button" type="button" aria-label={tr('关闭历史', 'Close history')} onClick={onClose}><X size={19} /></button>
        </div>

        <div className="history-toolbar">
          <label className="history-search"><Search size={17} aria-hidden="true" /><input ref={searchRef} type="search" aria-label={tr('搜索历史记录', 'Search history')} placeholder={tr('搜索文件名或差异摘要', 'Search file names or difference summaries')} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <div className="history-filter">{tr('类型', 'Type')} <Dropdown value={mode} onChange={(value) => setMode(value as HistoryMode | 'all')} ariaLabel={tr('按对比类型筛选', 'Filter by comparison type')} options={[{ value: 'all', label: tr('全部类型', 'All types') }, ...(Object.keys(modeInfo) as HistoryMode[]).map((key) => ({ value: key, label: modeLabel(key, tr) }))]} /></div>
          {entries.length > 0 && <div className="history-clear-controls">{confirmClear ? <><button className="history-button" type="button" onClick={() => setConfirmClear(false)}>{tr('取消', 'Cancel')}</button><button className="history-button history-button-danger" type="button" disabled={clearing} onClick={() => void clear()}>{clearing ? tr('正在清空…', 'Clearing…') : tr('确认清空', 'Confirm clear')}</button></> : <button className="history-button" type="button" onClick={() => setConfirmClear(true)}><Trash2 size={15} /> {tr('清空历史', 'Clear history')}</button>}</div>}
        </div>

        {error && <div className="history-error" role="alert">{historyErrors[error] ? tr(error, historyErrors[error]) : error}</div>}
        <div className="history-list" aria-live="polite">
          {loading ? <div className="history-empty"><Clock3 size={30} /><strong>{tr('正在读取本地历史…', 'Loading local history…')}</strong></div> : filtered.length === 0 ? (
            <div className="history-empty"><Clock3 size={30} /><strong>{entries.length ? tr('没有匹配的记录', 'No matching records') : tr('还没有对比历史', 'No comparison history yet')}</strong><span>{entries.length ? tr('试试其他文件名，或切换类型筛选。', 'Try another file name or change the type filter.') : tr('完成一次对比后，记录会自动出现在这里。', 'Records will appear here after you complete a comparison.')}</span></div>
          ) : filtered.map((entry) => {
            const info = modeInfo[entry.mode]
            const Icon = info.icon
            return <article className="history-item" key={entry.id}>
              <span className={`history-item-icon history-item-icon--${entry.mode}`}><Icon size={19} /></span>
              <div className="history-item-main">
                <div className="history-item-top"><span className="history-type">{modeLabel(entry.mode, tr)}</span><time dateTime={new Date(entry.createdAt).toISOString()}>{timeLabel(entry.createdAt, language)}</time></div>
                <div className="history-names" title={`${historyName(entry, 'left', tr)} → ${historyName(entry, 'right', tr)}`}><span>{historyName(entry, 'left', tr)}</span><span className="history-arrow">→</span><span>{historyName(entry, 'right', tr)}</span></div>
                <div className="history-summary">{localizedSummary(entry.summary, tr)}</div>
                {!entry.replayable && <div className="history-unavailable">{localizedReason(entry.unavailableReason, tr)}</div>}
              </div>
              <div className="history-item-actions">
                {entry.replayable ? <button className="history-button history-button-open" type="button" disabled={busyId !== null || clearing} onClick={() => void replay(entry)}><RotateCcw size={15} /> {busyId === entry.id ? tr('打开中…', 'Opening…') : tr('重开', 'Reopen')}</button> : <span className="history-summary-badge">{tr('仅摘要', 'Summary only')}</span>}
                <button className="history-icon-button history-delete" type="button" aria-label={tr(`删除 ${historyName(entry, 'left', tr)} 与 ${historyName(entry, 'right', tr)} 的历史记录`, `Delete history for ${historyName(entry, 'left', tr)} and ${historyName(entry, 'right', tr)}`)} title={tr('删除记录', 'Delete record')} disabled={busyId !== null || clearing} onClick={() => void remove(entry.id)}><Trash2 size={16} /></button>
              </div>
            </article>
          })}
        </div>

        <div className="history-foot"><LockKeyhole size={15} /><span>{tr('历史和可重开的文件快照仅保存在本机。大文件及文件夹只保留摘要。', 'History and reopenable file snapshots stay on this device. Large files and folders keep summaries only.')}</span></div>
      </div>
    </div>
  )
}
