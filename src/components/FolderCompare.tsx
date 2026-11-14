import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeftRight, ArrowRight, Check, ChevronRight, File, FileText, Filter, FolderClosed, FolderOpen, RotateCcw, Search } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { compareFolderFiles } from '../lib/folder'
import { formatBytes, isTauriApp, isTextFileName } from '../lib/files'
import type { TextPair } from './TextCompare'
import Dropdown from './Dropdown'
import type { HistoryRecordInput } from '../lib/history'
import { useLanguage } from '../i18n'

type NativeEntry = { relativePath: string; size: number; hash: string; absolutePath: string }
type NativeSelection = { folderPath: string; entries: NativeEntry[] }
type FolderSource = { kind: 'web'; name: string; files: File[] } | { kind: 'native'; name: string; entries: NativeEntry[] }
type FolderRow = { path: string; status: 'same' | 'changed' | 'left-only' | 'right-only'; left?: File | NativeEntry; right?: File | NativeEntry; sizeLeft?: number; sizeRight?: number }
type FilterValue = 'all' | FolderRow['status']
type DirectoryNode = {
  path: string
  name: string
  directories: Map<string, DirectoryNode>
  files: FolderRow[]
  counts: Record<FolderRow['status'], number>
  sizeLeft: number
  sizeRight: number
  hasLeft: boolean
  hasRight: boolean
}
type TreeRow = { kind: 'directory'; node: DirectoryNode; depth: number; expanded: boolean } | { kind: 'file'; row: FolderRow; depth: number }
type Props = { onOpenTextPair: (pair: TextPair) => void; onCompared?: (record: HistoryRecordInput) => void; initialFolderSelections?: { left: NativeSelection; right: NativeSelection }; autoCompare?: boolean; recordAutoCompare?: boolean; onFileNameChange?: (fileName: string | null) => void }

type FolderErrorCode = 'compare' | 'pick' | 'open' | 'not-text' | 'outside-folders' | 'not-file' | 'expected-file' | 'expected-directory' | 'mixed-types'
type FolderError = { code: FolderErrorCode; path?: string }
type Translate = (zh: string, en: string) => string

function errorFromCause(cause: unknown, fallback: FolderErrorCode, path?: string): FolderError {
  const message = typeof cause === 'string' ? cause : cause instanceof Error ? cause.message : ''
  if (message === 'File is outside the selected folders') return { code: 'outside-folders', path }
  if (message === 'Selected path is not a file') return { code: 'not-file', path }
  if (message === 'Cannot compare a file with a directory') return { code: 'mixed-types' }
  const expectedFile = message.match(/^Expected a file: (.+)$/)
  if (expectedFile) return { code: 'expected-file', path: expectedFile[1] }
  const expectedDirectory = message.match(/^Expected a directory: (.+)$/)
  if (expectedDirectory) return { code: 'expected-directory', path: expectedDirectory[1] }
  return { code: fallback, path }
}

function errorLabel(error: FolderError, tr: Translate): string {
  const labels: Record<FolderErrorCode, string> = {
    compare: tr('文件夹对比失败', 'Folder comparison failed'),
    pick: tr('系统文件夹选择失败，请使用下方备用方式', 'System folder picker failed. Use the alternate picker below.'),
    open: tr('打开文件失败', 'Failed to open file'),
    'not-text': tr('该文件不是常见文本格式，请在对应的比较模式中打开。', 'This is not a common text format. Open it in the matching comparison mode.'),
    'outside-folders': tr('文件不在已选文件夹内', 'File is outside the selected folders'),
    'not-file': tr('所选路径不是文件', 'Selected path is not a file'),
    'expected-file': tr('需要文件', 'Expected a file'),
    'expected-directory': tr('需要文件夹', 'Expected a directory'),
    'mixed-types': tr('不能将文件与文件夹对比', 'Cannot compare a file with a directory'),
  }
  return error.path ? `${labels[error.code]}${tr(`（${error.path}）`, ` (${error.path})`)}` : labels[error.code]
}

function sourceName(source: FolderSource, tr: Translate): string {
  return source.name || tr('已选择文件夹', 'Selected folder')
}

function fileCountLabel(count: number, tr: (zh: string, en: string) => string): string {
  return tr(`${count} 个文件`, `${count} file${count === 1 ? '' : 's'}`)
}

function nativeSource(selection: NativeSelection): FolderSource {
  return { kind: 'native', name: selection.folderPath.split(/[\\/]/).filter(Boolean).at(-1) ?? selection.folderPath, entries: selection.entries }
}

export default function FolderCompare({ onOpenTextPair, onCompared, initialFolderSelections, autoCompare = false, recordAutoCompare = false, onFileNameChange }: Props) {
  const { language, tr } = useLanguage()
  const rootRef = useRef<HTMLDivElement>(null)
  const onFileNameChangeRef = useRef(onFileNameChange)
  onFileNameChangeRef.current = onFileNameChange
  const [left, setLeft] = useState<FolderSource | null>(() => initialFolderSelections ? nativeSource(initialFolderSelections.left) : null)
  const [right, setRight] = useState<FolderSource | null>(() => initialFolderSelections ? nativeSource(initialFolderSelections.right) : null)
  const [rows, setRows] = useState<FolderRow[] | null>(null)
  const [resultSources, setResultSources] = useState<{ left: FolderSource; right: FolderSource } | null>(null)
  const [showResult, setShowResult] = useState(false)
  const [loading, setLoading] = useState(false)
  const [picking, setPicking] = useState<'left' | 'right' | null>(null)
  const [error, setError] = useState<FolderError | null>(null)
  const [filter, setFilter] = useState<FilterValue>('all')
  const [search, setSearch] = useState('')
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(() => new Set())
  const leftInput = useRef<HTMLInputElement>(null)
  const rightInput = useRef<HTMLInputElement>(null)
  const autoStarted = useRef(false)
  const compareToken = useRef(0)

  const selectedFileName = left?.name || right?.name || null
  useEffect(() => {
    onFileNameChangeRef.current?.(selectedFileName)
  }, [selectedFileName])

  useEffect(() => {
    if (autoCompare && initialFolderSelections && !autoStarted.current) {
      autoStarted.current = true
      void startCompare({ left: nativeSource(initialFolderSelections.left), right: nativeSource(initialFolderSelections.right) }, recordAutoCompare)
    }
    // External launch mounts this component with a new key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    rootRef.current?.closest('.main-scroll')?.scrollTo(0, 0)
  }, [showResult])

  async function startCompare(sources = left && right ? { left, right } : null, record = true) {
    if (!sources || loading || picking) return
    const token = ++compareToken.current
    setError(null)
    setLoading(true)
    try {
      const result = await compareSources(sources.left, sources.right)
      if (token !== compareToken.current) return
      setRows(result)
      setResultSources(sources)
      setExpandedDirectories(new Set())
      setShowResult(true)
      const differences = result.filter((row) => row.status !== 'same').length
      if (record) onCompared?.({ mode: 'folder', leftName: sources.left.name || '—', rightName: sources.right.name || '—', summary: `${differences} 个文件不同`, payload: { kind: 'folder' } })
    } catch (cause) {
      if (token === compareToken.current) setError(errorFromCause(cause, 'compare'))
    } finally {
      if (token === compareToken.current) setLoading(false)
    }
  }

  const counts = useMemo(() => (rows ?? []).reduce((result, row) => {
    result[row.status] += 1
    return result
  }, { same: 0, changed: 0, 'left-only': 0, 'right-only': 0 }), [rows])
  const searchQuery = search.trim().toLowerCase()
  const visibleRows = useMemo(() => (rows ?? []).filter((row) => (filter === 'all' || row.status === filter) && row.path.toLowerCase().includes(searchQuery)), [rows, filter, searchQuery])
  const tree = useMemo(() => buildFolderTree(rows ?? []), [rows])
  const treeRows = useMemo(() => flattenFolderTree(tree, visibleRows, expandedDirectories, Boolean(searchQuery), language), [tree, visibleRows, expandedDirectories, searchQuery, language])

  function toggleDirectory(path: string) {
    setExpandedDirectories((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  async function pick(side: 'left' | 'right') {
    setError(null)
    if (!isTauriApp()) {
      (side === 'left' ? leftInput : rightInput).current?.click()
      return
    }
    setPicking(side)
    try {
      const selection = await invoke<NativeSelection | null>('pick_folder_entries')
      if (!selection) return
      const segments = selection.folderPath.split(/[\\/]/).filter(Boolean)
      const name = segments.at(-1) ?? selection.folderPath
      const source: FolderSource = { kind: 'native', name, entries: selection.entries }
      ++compareToken.current
      setLoading(false)
      if (side === 'left') setLeft(source)
      else setRight(source)
    } catch (cause) {
      setError(errorFromCause(cause, 'pick'))
    } finally {
      setPicking(null)
    }
  }

  function pickedFiles(side: 'left' | 'right', files: FileList | null) {
    const selected = Array.from(files ?? [])
    if (!selected.length) return
    const name = selected[0].webkitRelativePath.split('/')[0]
    const source: FolderSource = { kind: 'web', name, files: selected }
    ++compareToken.current
    setLoading(false)
    if (side === 'left') setLeft(source)
    else setRight(source)
  }

  async function openRow(row: FolderRow) {
    if (!isTextFileName(row.path)) { setError({ code: 'not-text', path: row.path }); return }
    try {
      const [leftText, rightText] = await Promise.all([readText(row.left), readText(row.right)])
      onOpenTextPair({ leftName: resultSources?.left.name ? `${resultSources.left.name}/${row.path}` : row.path, rightName: resultSources?.right.name ? `${resultSources.right.name}/${row.path}` : row.path, leftText, rightText })
    } catch (cause) {
      setError(errorFromCause(cause, 'open', row.path))
    }
  }

  return (
    <div ref={rootRef} className={`mode-content ${showResult ? 'comparison-stage--result' : ''}`}>
      {!showResult && (
      <div className="workspace-card">
        <div className="card-titlebar"><div><div className="eyebrow">{tr('选择目录', 'Select folders')}</div><h2>{tr('递归对比两个文件夹', 'Compare two folders recursively')}</h2></div><span className="format-hint">{tr('按相对路径和文件内容比对', 'Compare relative paths and file contents')}</span></div>
        <div className="file-pair-grid folder-pair">
          {(['left', 'right'] as const).map((side) => {
            const source = side === 'left' ? left : right
            const inputRef = side === 'left' ? leftInput : rightInput
            return <div key={side}>
              <div className="file-side-label"><span className={`side-dot ${side}`} /> {side === 'left' ? tr('原始文件夹', 'Original folder') : tr('修改后文件夹', 'Modified folder')}</div>
              <button className={`folder-picker ${source ? 'has-folder' : ''}`} type="button" disabled={picking !== null} onClick={() => void pick(side)}>
                <span className="folder-picker__icon">{source ? <FolderOpen size={25} /> : <FolderClosed size={25} />}</span>
                <span className="folder-picker__copy"><strong>{picking === side ? tr('正在扫描文件…', 'Scanning files…') : source ? sourceName(source, tr) : tr('选择文件夹', 'Select folder')}</strong><small>{source ? `${fileCountLabel(source.kind === 'web' ? source.files.length : source.entries.length, tr)} · ${tr('点击更换', 'Click to change')}` : tr('选择本机文件夹，自动扫描所有子目录', 'Choose a local folder to scan all subfolders')}</small></span>
                <ChevronRight size={17} />
              </button>
              <input ref={inputRef} className="visually-hidden" type="file" multiple {...{ webkitdirectory: '' }} aria-label={side === 'left' ? tr('选择原始文件夹', 'Select original folder') : tr('选择修改后文件夹', 'Select modified folder')} onChange={(event) => { pickedFiles(side, event.target.files); event.currentTarget.value = '' }} />
              {isTauriApp() && <button className="folder-fallback" type="button" onClick={() => inputRef.current?.click()}>{tr('使用兼容目录选择器', 'Use alternate folder picker')}</button>}
            </div>
          })}
        </div>
        {error && <div className="inline-error" role="alert">{errorLabel(error, tr)}</div>}
        <div className="compare-action-bar"><span>{tr('选择两个文件夹后开始递归比对。', 'Choose two folders to start a recursive comparison.')}</span><button className="button button-primary compare-start-button" type="button" disabled={!left || !right || Boolean(picking) || loading} onClick={() => void startCompare()}>{loading ? tr('正在比对…', 'Comparing…') : tr('开始比对', 'Compare')} <ArrowRight size={16} /></button></div>
      </div>
      )}

      {showResult && resultSources && (
      <div className="workspace-card result-card folder-result">
        <div className="compare-result-header"><div><div className="eyebrow">{tr('文件夹对比结果', 'Folder comparison results')}</div><div className="compare-result-names"><span title={sourceName(resultSources.left, tr)}>{sourceName(resultSources.left, tr)}</span><ArrowLeftRight size={16} /><span title={sourceName(resultSources.right, tr)}>{sourceName(resultSources.right, tr)}</span></div></div><div className="compare-result-actions"><button className="button button-secondary" type="button" onClick={() => { ++compareToken.current; setLoading(false); setShowResult(false) }}>{tr('返回修改', 'Back to edit')}</button><button className="button button-primary" type="button" disabled={loading} onClick={() => void startCompare()}><RotateCcw size={15} /> {loading ? tr('正在比对…', 'Comparing…') : tr('重新比对', 'Compare again')}</button></div></div>
        {error && <div className="inline-error" role="alert">{errorLabel(error, tr)}</div>}
        <div className="card-titlebar result-titlebar"><div><div className="eyebrow">{tr('目录差异', 'Folder differences')}</div><h2>{tr('文件夹对比结果', 'Folder comparison results')} {rows && <span className="result-count">{fileCountLabel(rows.length, tr)}</span>}</h2></div></div>
        {!rows ? <div className="empty-result"><FolderClosed size={29} /><strong>{tr('暂无比较结果', 'No comparison results yet')}</strong></div> : <>
          <div className="result-summary">
            <div className="summary-stat modified"><span className="summary-sign">~</span><strong>{counts.changed}</strong><span>{tr('内容不同', 'Changed')}</span></div>
            <div className="summary-stat removed"><span className="summary-sign">−</span><strong>{counts['left-only']}</strong><span>{tr('仅原始', 'Original only')}</span></div>
            <div className="summary-stat added"><span className="summary-sign">+</span><strong>{counts['right-only']}</strong><span>{tr('仅修改后', 'Modified only')}</span></div>
            <div className="summary-stat total"><Check size={16} /><strong>{counts.same}</strong><span>{tr('相同文件', 'Identical files')}</span></div>
          </div>
          <div className="result-toolbar folder-toolbar">
            <div className="search-field"><Search size={15} /><input aria-label={tr('搜索文件名', 'Search file names')} placeholder={tr('搜索文件名或路径', 'Search file names or paths')} value={search} onChange={(event) => setSearch(event.target.value)} /></div>
            <div className="toolbar-spacer" />
            <Filter size={15} className="muted-icon" />
            <Dropdown value={filter} onChange={(value) => setFilter(value as FilterValue)} ariaLabel={tr('按状态筛选', 'Filter by status')} options={[{ value: 'all', label: tr('全部文件', 'All files') }, { value: 'changed', label: tr('内容不同', 'Changed') }, { value: 'left-only', label: tr('仅原始', 'Original only') }, { value: 'right-only', label: tr('仅修改后', 'Modified only') }, { value: 'same', label: tr('相同', 'Identical') }]} />
          </div>
          <div className="folder-table-wrap"><table className="folder-table"><thead><tr><th>{tr('名称 / 相对路径', 'Name / Relative path')}</th><th>{tr('原始大小', 'Original size')}</th><th>{tr('修改后大小', 'Modified size')}</th><th>{tr('状态', 'Status')}</th><th /></tr></thead><tbody>
            {treeRows.map((item) => item.kind === 'directory' ? (
              <tr key={`directory:${item.node.path}`} className={`folder-tree-directory folder-tree-directory--${directoryStatus(item.node)}`}>
                <td style={{ paddingLeft: 14 + item.depth * 18 }}>
                  <button className="folder-tree-toggle" type="button" disabled={Boolean(searchQuery)} title={searchQuery ? tr('搜索结果会自动展开匹配路径', 'Matching paths expand automatically during search') : undefined} aria-expanded={item.expanded} aria-label={`${searchQuery ? tr('搜索结果自动展开', 'Search result expanded automatically') : item.expanded ? tr('折叠', 'Collapse') : tr('展开', 'Expand')} ${item.node.path}`} onClick={() => toggleDirectory(item.node.path)}>
                    <ChevronRight size={15} style={{ transform: item.expanded ? 'rotate(90deg)' : undefined }} />
                  </button>
                  <span className="folder-path-icon">{item.expanded ? <FolderOpen size={16} /> : <FolderClosed size={16} />}</span>
                  <span className="folder-path" title={item.node.path}>{item.node.name}</span>
                  <span className="folder-tree-count">{fileCountLabel(directoryFileCount(item.node), tr)}</span>
                </td>
                <td>{formatBytes(item.node.hasLeft ? item.node.sizeLeft : undefined)}</td>
                <td>{formatBytes(item.node.hasRight ? item.node.sizeRight : undefined)}</td>
                <td><span className={`status-pill ${directoryStatus(item.node)}`}>{directoryStatusLabel(directoryStatus(item.node), tr)}</span></td>
                <td />
              </tr>
            ) : (
              <tr key={`file:${item.row.path}`} className="folder-tree-file" onDoubleClick={() => void openRow(item.row)}>
                <td style={{ paddingLeft: 14 + item.depth * 18 }}>
                  <span className="folder-tree-spacer" aria-hidden="true" />
                  <span className="folder-path-icon">{isTextFileName(item.row.path) ? <FileText size={16} /> : <File size={16} />}</span>
                  <span className="folder-path" title={item.row.path}>{fileName(item.row.path)}</span>
                </td>
                <td>{formatBytes(item.row.sizeLeft)}</td>
                <td>{formatBytes(item.row.sizeRight)}</td>
                <td><span className={`status-pill ${item.row.status}`}>{folderStatusLabel(item.row.status, tr)}</span></td>
                <td><button className="icon-button subtle" aria-label={tr(`打开 ${item.row.path}`, `Open ${item.row.path}`)} title={tr('打开文本差异', 'Open text differences')} type="button" onClick={() => void openRow(item.row)}><ChevronRight size={16} /></button></td>
              </tr>
            ))}
            {!visibleRows.length && <tr><td colSpan={5} className="folder-no-match">{rows.length ? tr('没有符合筛选条件的文件', 'No files match the current filter') : tr('两个文件夹中均无可比较文件', 'Neither folder contains comparable files')}</td></tr>}
          </tbody></table></div>
          <div className="table-footnote">{tr('双击文本文件可查看逐行差异。二进制文件按内容哈希判断是否相同。', 'Double-click a text file to view line differences. Binary files are compared by content hash.')}</div>
        </>}
      </div>
      )}
    </div>
  )
}

function folderStatusLabel(status: FolderRow['status'], tr: (zh: string, en: string) => string): string {
  return { same: tr('相同', 'Identical'), changed: tr('内容不同', 'Changed'), 'left-only': tr('仅原始', 'Original only'), 'right-only': tr('仅修改后', 'Modified only') }[status]
}

function directoryStatusLabel(status: FolderRow['status'], tr: (zh: string, en: string) => string): string {
  return { same: tr('全部相同', 'All identical'), changed: tr('内部不同', 'Contains changes'), 'left-only': tr('仅原始', 'Original only'), 'right-only': tr('仅修改后', 'Modified only') }[status]
}

function directoryStatus(directory: DirectoryNode): FolderRow['status'] {
  const statuses = (['same', 'changed', 'left-only', 'right-only'] as const).filter((status) => directory.counts[status] > 0)
  return statuses.length === 1 ? statuses[0] : 'changed'
}

function directoryFileCount(directory: DirectoryNode): number {
  return directory.counts.same + directory.counts.changed + directory.counts['left-only'] + directory.counts['right-only']
}

function createDirectory(path: string, name: string): DirectoryNode {
  return { path, name, directories: new Map(), files: [], counts: { same: 0, changed: 0, 'left-only': 0, 'right-only': 0 }, sizeLeft: 0, sizeRight: 0, hasLeft: false, hasRight: false }
}

function buildFolderTree(rows: FolderRow[]): DirectoryNode {
  const root = createDirectory('', '')
  for (const row of rows) {
    const segments = row.path.split('/').filter(Boolean)
    let parent = root
    for (const segment of segments.slice(0, -1)) {
      let directory = parent.directories.get(segment)
      if (!directory) {
        directory = createDirectory(parent.path ? `${parent.path}/${segment}` : segment, segment)
        parent.directories.set(segment, directory)
      }
      directory.counts[row.status] += 1
      directory.sizeLeft += row.sizeLeft ?? 0
      directory.sizeRight += row.sizeRight ?? 0
      directory.hasLeft ||= Boolean(row.left)
      directory.hasRight ||= Boolean(row.right)
      parent = directory
    }
    parent.files.push(row)
  }
  return root
}

function flattenFolderTree(root: DirectoryNode, visibleRows: FolderRow[], expandedDirectories: Set<string>, searching: boolean, language: string): TreeRow[] {
  const visibleFiles = new Set(visibleRows.map((row) => row.path))
  const visibleDirectories = new Set<string>()
  for (const row of visibleRows) {
    const segments = row.path.split('/').filter(Boolean)
    let path = ''
    for (const segment of segments.slice(0, -1)) {
      path = path ? `${path}/${segment}` : segment
      visibleDirectories.add(path)
    }
  }

  const output: TreeRow[] = []
  function visit(directory: DirectoryNode, depth: number) {
    const children = [
      ...Array.from(directory.directories.values(), (node) => ({ kind: 'directory' as const, name: node.name, node })),
      ...directory.files.map((row) => ({ kind: 'file' as const, name: fileName(row.path), row })),
    ].sort((a, b) => {
      const byName = a.name.localeCompare(b.name, language)
      return byName || (a.kind === b.kind ? 0 : a.kind === 'directory' ? -1 : 1)
    })
    for (const child of children) {
      if (child.kind === 'file') {
        if (visibleFiles.has(child.row.path)) output.push({ kind: 'file', row: child.row, depth })
        continue
      }
      if (!visibleDirectories.has(child.node.path)) continue
      const expanded = searching || expandedDirectories.has(child.node.path)
      output.push({ kind: 'directory', node: child.node, depth, expanded })
      if (expanded) visit(child.node, depth + 1)
    }
  }
  visit(root, 0)
  return output
}

function fileName(path: string): string {
  return path.split('/').at(-1) ?? path
}

function filePath(file: File): string {
  const segments = file.webkitRelativePath.split('/').filter(Boolean)
  return segments.length > 1 ? segments.slice(1).join('/') : file.name
}

async function fileHash(file: File): Promise<string> {
  const data = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(data), (value) => value.toString(16).padStart(2, '0')).join('')
}

async function compareSources(left: FolderSource, right: FolderSource): Promise<FolderRow[]> {
  if (left.kind === 'web' && right.kind === 'web') {
    const entries = await compareFolderFiles(left.files, right.files)
    return entries.map((entry) => ({ ...entry, sizeLeft: entry.left?.size, sizeRight: entry.right?.size }))
  }
  const leftEntries = new Map<string, File | NativeEntry>(left.kind === 'web' ? left.files.map((file): [string, File | NativeEntry] => [filePath(file), file]) : left.entries.map((entry): [string, File | NativeEntry] => [entry.relativePath, entry]))
  const rightEntries = new Map<string, File | NativeEntry>(right.kind === 'web' ? right.files.map((file): [string, File | NativeEntry] => [filePath(file), file]) : right.entries.map((entry): [string, File | NativeEntry] => [entry.relativePath, entry]))
  const paths = [...new Set([...leftEntries.keys(), ...rightEntries.keys()])].sort((a, b) => a.localeCompare(b))
  const output: FolderRow[] = []
  for (const path of paths) {
    const leftEntry = leftEntries.get(path)
    const rightEntry = rightEntries.get(path)
    let status: FolderRow['status']
    if (!leftEntry) status = 'right-only'
    else if (!rightEntry) status = 'left-only'
    else if (leftEntry.size !== rightEntry.size) status = 'changed'
    else {
      const [leftHash, rightHash] = await Promise.all(['absolutePath' in leftEntry ? leftEntry.hash : fileHash(leftEntry), 'absolutePath' in rightEntry ? rightEntry.hash : fileHash(rightEntry)])
      status = leftHash === rightHash ? 'same' : 'changed'
    }
    output.push({ path, status, left: leftEntry, right: rightEntry, sizeLeft: leftEntry?.size, sizeRight: rightEntry?.size })
  }
  return output
}

async function readText(entry?: File | NativeEntry): Promise<string> {
  if (!entry) return ''
  if (!('absolutePath' in entry)) return entry.text()
  const bytes = await invoke<number[]>('read_file_bytes', { path: entry.absolutePath })
  return new TextDecoder().decode(new Uint8Array(bytes))
}
