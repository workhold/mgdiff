import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  ArrowDownToLine, ArrowLeftRight, ArrowRight, Check, ChevronDown, ChevronUp,
  Columns2, Copy, FileCode2, FileText, List, RotateCcw, Upload,
} from 'lucide-react'
import FileDropzone from './FileDropzone'
import { saveTextFile } from '../lib/files'
import { buildTextDiff, inlineParts, mergeDiffBlock, patchFor, preserveEditedLineEndings, textStats, type DiffPrecision, type TextDiffRow } from '../lib/text'
import type { HistoryRecordInput } from '../lib/history'
import { useLanguage } from '../i18n'
import { useWorkspaceState } from '../lib/workspace-state'

const SAMPLE_LEFT = `function formatPrice(amount, currency = 'USD') {
  const formatted = amount.toFixed(2);
  return currency + ' ' + formatted;
}

const total = formatPrice(49.9);
console.log(total);`

const SAMPLE_RIGHT = `function formatPrice(amount, currency = 'USD') {
  const formatted = amount.toFixed(2);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amount);
}

const total = formatPrice(59.9);
console.log('Total:', total);`

export type TextPair = { leftName: string; rightName: string; leftText: string; rightText: string; leftUntitled?: boolean; rightUntitled?: boolean }

type Props = { initialPair?: TextPair; autoCompare?: boolean; recordAutoCompare?: boolean; onCompared?: (record: HistoryRecordInput) => void; onFileNameChange?: (fileName: string | null) => void }
type TextSnapshot = TextPair & { ignoreWhitespace: boolean; ignoreCase: boolean; leftUntitled: boolean; rightUntitled: boolean }

function DiffCode({ row, side, ignoreEolFormat, precision }: { row: TextDiffRow; side: 'left' | 'right'; ignoreEolFormat: boolean; precision: DiffPrecision }) {
  const { tr } = useLanguage()
  const value = side === 'left' ? row.left : row.right
  if (value === undefined) return <span className="diff-empty"> </span>
  if (row.status !== 'modified') return <>{value || ' '}</>
  const eol = side === 'left' ? row.leftEol : row.rightEol
  const eolChanged = row.leftEol !== row.rightEol && (
    !ignoreEolFormat || !row.leftEol || !row.rightEol
  )
  const eolLabel = eol === '\r\n' ? 'CRLF' : eol === '\n' ? 'LF' : eol === '\r' ? 'CR' : tr('无末尾换行', 'No final newline')
  return <>{inlineParts(row.left ?? '', row.right ?? '', side, precision).map((part, index) => (
    <span key={index} className={part.changed ? `inline-${side}` : undefined}>{part.text}</span>
  ))}{eolChanged && <span className={`inline-${side}`} title={tr('行尾字符', 'Line ending')}> [{eolLabel}]</span>}</>
}

export default function TextCompare({ initialPair, autoCompare = false, recordAutoCompare = false, onCompared, onFileNameChange }: Props) {
  const { tr } = useLanguage()
  const rootRef = useRef<HTMLDivElement>(null)
  const diffRowPrefix = useId()
  const onFileNameChangeRef = useRef(onFileNameChange)
  onFileNameChangeRef.current = onFileNameChange
  const [leftText, setLeftText] = useWorkspaceState('text.leftText', initialPair?.leftText ?? SAMPLE_LEFT)
  const [rightText, setRightText] = useWorkspaceState('text.rightText', initialPair?.rightText ?? SAMPLE_RIGHT)
  const [leftFile, setLeftFile] = useState<File | null>(null)
  const [rightFile, setRightFile] = useState<File | null>(null)
  const [leftName, setLeftName] = useWorkspaceState('text.leftName', initialPair?.leftName ?? 'original.js')
  const [rightName, setRightName] = useWorkspaceState('text.rightName', initialPair?.rightName ?? 'modified.js')
  const [leftUntitled, setLeftUntitled] = useWorkspaceState('text.leftUntitled', initialPair?.leftUntitled ?? false)
  const [rightUntitled, setRightUntitled] = useWorkspaceState('text.rightUntitled', initialPair?.rightUntitled ?? false)
  const [leftHasRealName, setLeftHasRealName] = useWorkspaceState('text.leftHasRealName', Boolean(initialPair && !initialPair.leftUntitled))
  const [rightHasRealName, setRightHasRealName] = useWorkspaceState('text.rightHasRealName', Boolean(initialPair && !initialPair.rightUntitled))
  const [ignoreWhitespace, setIgnoreWhitespace] = useWorkspaceState('text.ignoreWhitespace', false)
  const [ignoreCase, setIgnoreCase] = useWorkspaceState('text.ignoreCase', false)
  const [comparison, setComparison] = useWorkspaceState<TextSnapshot | null>('text.comparison', () => autoCompare && initialPair ? { ...initialPair, ignoreWhitespace: false, ignoreCase: false, leftUntitled: initialPair.leftUntitled ?? false, rightUntitled: initialPair.rightUntitled ?? false } : null)
  const [showSame, setShowSame] = useWorkspaceState('text.showSame', true)
  const [view, setView] = useWorkspaceState<'split' | 'unified'>('text.view', 'split')
  const [precision, setPrecision] = useWorkspaceState<DiffPrecision>('text.precision', 'smart')
  const [wrapLines, setWrapLines] = useWorkspaceState('text.wrapLines', true)
  const [activeDiff, setActiveDiff] = useWorkspaceState('text.activeDiff', 0)
  const [error, setError] = useState<'binary' | 'read' | null>(null)
  const leftGutter = useRef<HTMLDivElement>(null)
  const rightGutter = useRef<HTMLDivElement>(null)
  const leftEditor = useRef<HTMLTextAreaElement>(null)
  const rightEditor = useRef<HTMLTextAreaElement>(null)
  const autoRecorded = useRef(false)

  useEffect(() => {
    if (!autoCompare || !recordAutoCompare || !initialPair || autoRecorded.current) return
    autoRecorded.current = true
    const initialStats = textStats(buildTextDiff(initialPair.leftText, initialPair.rightText, { ignoreWhitespace: false, ignoreCase: false }))
    onCompared?.({ mode: 'text', leftName: initialPair.leftName, rightName: initialPair.rightName, leftUntitled: initialPair.leftUntitled ?? false, rightUntitled: initialPair.rightUntitled ?? false, summary: `${initialStats.added + initialStats.removed + initialStats.modified} 处差异`, payload: { kind: 'text', leftText: initialPair.leftText, rightText: initialPair.rightText } })
    // CLI launch mounts this component with a new key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    rootRef.current?.closest('.main-scroll')?.scrollTo(0, 0)
  }, [Boolean(comparison)])

  const selectedFileName = leftHasRealName ? leftName : rightHasRealName ? rightName : null
  useEffect(() => {
    onFileNameChangeRef.current?.(selectedFileName)
  }, [selectedFileName])

  const rows = useMemo(() => comparison ? buildTextDiff(comparison.leftText, comparison.rightText, { ignoreWhitespace: comparison.ignoreWhitespace, ignoreCase: comparison.ignoreCase }) : [], [comparison])
  const stats = useMemo(() => textStats(rows), [rows])
  const diffRowIds = useMemo(() => rows.filter((row) => row.status !== 'same').map((row) => row.id), [rows])
  const selectedDiff = Math.min(activeDiff, Math.max(0, diffRowIds.length - 1))
  const activeRowId = diffRowIds[selectedDiff]
  const visibleRows = showSame ? rows : rows.filter((row) => row.status !== 'same')
  // An intentionally empty text side is valid: it represents a pure addition or deletion.
  const ready = Boolean(leftText || rightText || leftFile || rightFile)
  const displayName = (name: string, untitled: boolean) => untitled ? tr('未命名', 'Untitled') : name
  const displayError = error === 'binary'
    ? tr('该文件包含二进制内容，请选择文本文件', 'This file contains binary content. Choose a text file.')
    : error === 'read' ? tr('读取文件失败', 'Failed to read file') : null
  const differenceCount = stats.added + stats.removed + stats.modified

  function startCompare() {
    if (!ready) return
    const next: TextSnapshot = { leftText, rightText, leftName, rightName, ignoreWhitespace, ignoreCase, leftUntitled, rightUntitled }
    const nextStats = textStats(buildTextDiff(next.leftText, next.rightText, { ignoreWhitespace, ignoreCase }))
    setComparison(next)
    setActiveDiff(0)
    onCompared?.({ mode: 'text', leftName, rightName, leftUntitled: !leftHasRealName, rightUntitled: !rightHasRealName, summary: `${nextStats.added + nextStats.removed + nextStats.modified} 处差异`, payload: { kind: 'text', leftText, rightText } })
  }

  async function loadFile(side: 'left' | 'right', file: File | null) {
    setError(null)
    if (!file) {
      if (side === 'left') { setLeftFile(null); setLeftName('未命名'); setLeftUntitled(true); setLeftHasRealName(false); setLeftText('') }
      else { setRightFile(null); setRightName('未命名'); setRightUntitled(true); setRightHasRealName(false); setRightText('') }
      return
    }
    try {
      const content = await file.text()
      if (content.includes('\0')) { setError('binary'); return }
      if (side === 'left') { setLeftFile(file); setLeftName(file.name); setLeftUntitled(false); setLeftHasRealName(true); setLeftText(content) }
      else { setRightFile(file); setRightName(file.name); setRightUntitled(false); setRightHasRealName(true); setRightText(content) }
      setActiveDiff(0)
    } catch {
      setError('read')
    }
  }

  function jump(direction: -1 | 1) {
    if (!diffRowIds.length) return
    const next = (selectedDiff + direction + diffRowIds.length) % diffRowIds.length
    setActiveDiff(next)
    document.getElementById(`${diffRowPrefix}-diff-row-${diffRowIds[next]}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  function merge(direction: 'left-to-right' | 'right-to-left') {
    if (activeRowId === undefined || !comparison) return
    const merged = mergeDiffBlock(rows, activeRowId, direction)
    if (direction === 'left-to-right') {
      setComparison({ ...comparison, rightText: merged })
      setRightText(merged)
    } else {
      setComparison({ ...comparison, leftText: merged })
      setLeftText(merged)
    }
    setActiveDiff(0)
  }

  function reset() {
    setLeftText(''); setRightText(''); setLeftFile(null); setRightFile(null)
    setLeftName('未命名'); setRightName('未命名'); setLeftUntitled(true); setRightUntitled(true); setActiveDiff(0); setError(null)
    setLeftHasRealName(false); setRightHasRealName(false)
  }

  return (
    <div ref={rootRef} className={`mode-content text-mode ${comparison ? 'comparison-stage--result' : ''}`}>
      {!comparison && (
      <div className="workspace-card editor-card">
        <div className="card-titlebar">
          <div>
            <div className="eyebrow">{tr('文件输入', 'File input')}</div>
            <h2>{tr('选择文件，或直接粘贴文本', 'Choose files or paste text directly')}</h2>
          </div>
          <div className="card-actions">
            <button className="text-button" type="button" onClick={() => {
              setLeftText(rightText); setRightText(leftText)
              setLeftName(rightName); setRightName(leftName)
              setLeftUntitled(rightUntitled); setRightUntitled(leftUntitled)
              setLeftFile(rightFile); setRightFile(leftFile)
              setLeftHasRealName(rightHasRealName); setRightHasRealName(leftHasRealName)
            }}><ArrowLeftRight size={15} /> {tr('交换两侧', 'Swap sides')}</button>
            <button className="text-button" type="button" onClick={reset}><RotateCcw size={15} /> {tr('清空', 'Clear')}</button>
          </div>
        </div>
        <div className="editor-grid">
          <div className="editor-panel">
            <div className="editor-panel__heading"><span className="side-dot left" /> <strong>{tr('原始文件', 'Original file')}</strong><span className="editor-filename">{displayName(leftName, leftUntitled)}</span></div>
            <FileDropzone side="left" file={leftFile} hint={tr('拖入文本或代码文件', 'Drop a text or code file')} onFile={(file) => void loadFile('left', file)} compact />
            <div className="code-editor">
              <div className="code-editor__numbers" ref={leftGutter}>{Array.from({ length: Math.max(1, leftText.split(/\r\n|\r|\n/).length) }, (_, i) => <div key={i}>{i + 1}</div>)}</div>
              <textarea
                ref={leftEditor}
                spellCheck={false}
                aria-label={tr('原始文件文本', 'Original file text')}
                placeholder={tr('在这里粘贴原始文本…', 'Paste original text here…')}
                value={leftText}
                onChange={(event) => { const edited = event.currentTarget.value; setLeftText((previous) => preserveEditedLineEndings(previous, edited)); setLeftFile(null) }}
                onScroll={(event) => {
                  if (leftGutter.current) leftGutter.current.scrollTop = event.currentTarget.scrollTop
                  if (rightEditor.current) rightEditor.current.scrollTop = event.currentTarget.scrollTop
                  if (rightGutter.current) rightGutter.current.scrollTop = event.currentTarget.scrollTop
                }}
              />
            </div>
          </div>
          <div className="editor-panel">
            <div className="editor-panel__heading"><span className="side-dot right" /> <strong>{tr('修改后文件', 'Modified file')}</strong><span className="editor-filename">{displayName(rightName, rightUntitled)}</span></div>
            <FileDropzone side="right" file={rightFile} hint={tr('拖入文本或代码文件', 'Drop a text or code file')} onFile={(file) => void loadFile('right', file)} compact />
            <div className="code-editor">
              <div className="code-editor__numbers" ref={rightGutter}>{Array.from({ length: Math.max(1, rightText.split(/\r\n|\r|\n/).length) }, (_, i) => <div key={i}>{i + 1}</div>)}</div>
              <textarea
                ref={rightEditor}
                spellCheck={false}
                aria-label={tr('修改后文件文本', 'Modified file text')}
                placeholder={tr('在这里粘贴修改后的文本…', 'Paste modified text here…')}
                value={rightText}
                onChange={(event) => { const edited = event.currentTarget.value; setRightText((previous) => preserveEditedLineEndings(previous, edited)); setRightFile(null) }}
                onScroll={(event) => {
                  if (rightGutter.current) rightGutter.current.scrollTop = event.currentTarget.scrollTop
                  if (leftEditor.current) leftEditor.current.scrollTop = event.currentTarget.scrollTop
                  if (leftGutter.current) leftGutter.current.scrollTop = event.currentTarget.scrollTop
                }}
              />
            </div>
          </div>
        </div>
        {error && <div className="inline-error" role="alert">{displayError}</div>}
        <div className="compare-options">
          <label className="check-option" title={tr('忽略行内空白和 LF/CRLF/CR 格式；仍识别有无末尾换行', 'Ignore inline whitespace and LF/CRLF/CR formats; still detect a missing final newline')}><input type="checkbox" checked={ignoreWhitespace} onChange={(event) => setIgnoreWhitespace(event.target.checked)} /><span>{tr('忽略空格与行尾格式', 'Ignore whitespace and line endings')}</span></label>
          <label className="check-option"><input type="checkbox" checked={ignoreCase} onChange={(event) => setIgnoreCase(event.target.checked)} /><span>{tr('忽略大小写', 'Ignore case')}</span></label>
        </div>
        <div className="compare-action-bar"><span>{tr('准备好两个版本后，点击开始比对。', 'When both versions are ready, start the comparison.')}</span><button className="button button-primary compare-start-button" type="button" disabled={!ready} onClick={startCompare}>{tr('开始比对', 'Compare')} <ArrowRight size={16} /></button></div>
        <div className="editor-footer"><span><Check size={14} /> {tr('内容只在本机处理', 'Content is processed locally')}</span><span>{tr('支持拖拽文件 · 两侧同步滚动 · 可直接编辑', 'Drag and drop files · Synchronized scrolling · Edit directly')}</span></div>
      </div>
      )}

      {comparison && (
      <div className="workspace-card result-card">
        <div className="compare-result-header"><div><div className="eyebrow">{tr('文本对比结果', 'Text comparison result')}</div><div className="compare-result-names"><span title={displayName(comparison.leftName, comparison.leftUntitled)}>{displayName(comparison.leftName, comparison.leftUntitled)}</span><ArrowLeftRight size={16} /><span title={displayName(comparison.rightName, comparison.rightUntitled)}>{displayName(comparison.rightName, comparison.rightUntitled)}</span></div></div><div className="compare-result-actions"><button className="button button-secondary" type="button" onClick={() => setComparison(null)}>{tr('返回修改', 'Back to editing')}</button><button className="button button-primary" type="button" onClick={startCompare}><RotateCcw size={15} /> {tr('重新比对', 'Compare again')}</button></div></div>
        <div className="card-titlebar result-titlebar">
          <div>
            <div className="eyebrow">{tr('对比结果', 'Comparison result')}</div>
            <h2>{tr('差异概览', 'Difference overview')} <span className="result-count">{differenceCount} {tr('处差异', differenceCount === 1 ? 'difference' : 'differences')}</span></h2>
          </div>
          <div className="card-actions">
            <button className="button button-secondary" type="button" onClick={() => void saveTextFile(patchFor(comparison.leftText, comparison.rightText, comparison.leftName, comparison.rightName), 'changes.patch')}><ArrowDownToLine size={15} /> {tr('导出补丁', 'Export patch')}</button>
            <button className="button button-primary" type="button" onClick={() => void saveTextFile(comparison.rightText, comparison.rightUntitled ? 'merged.txt' : comparison.rightName)}><Upload size={15} /> {tr('保存右侧', 'Save right side')}</button>
          </div>
        </div>
        <div className="result-summary">
          <div className="summary-stat added"><span className="summary-sign">+</span><strong>{stats.added}</strong><span>{tr('新增行', stats.added === 1 ? 'Added line' : 'Added lines')}</span></div>
          <div className="summary-stat removed"><span className="summary-sign">−</span><strong>{stats.removed}</strong><span>{tr('删除行', stats.removed === 1 ? 'Removed line' : 'Removed lines')}</span></div>
          <div className="summary-stat modified"><span className="summary-sign">~</span><strong>{stats.modified}</strong><span>{tr('修改行', stats.modified === 1 ? 'Modified line' : 'Modified lines')}</span></div>
          <div className="summary-stat total"><FileText size={16} /><strong>{rows.length}</strong><span>{tr('对齐行', rows.length === 1 ? 'Aligned line' : 'Aligned lines')}</span></div>
        </div>
        <div className="result-toolbar">
          <div className="toolbar-group">
            <button className={`segmented-button ${view === 'split' ? 'selected' : ''}`} type="button" onClick={() => setView('split')}><Columns2 size={15} /> {tr('并排', 'Side by side')}</button>
            <button className={`segmented-button ${view === 'unified' ? 'selected' : ''}`} type="button" onClick={() => setView('unified')}><List size={15} /> {tr('统一', 'Unified')}</button>
          </div>
          <div className="toolbar-divider" />
          <span className="toolbar-label">{tr('高亮精度', 'Highlight detail')}</span>
          <div className="toolbar-group" aria-label={tr('高亮精度', 'Highlight detail')}>
            {([['smart', tr('智能', 'Smart')], ['word', tr('词', 'Word')], ['char', tr('字符', 'Character')]] as const).map(([value, label]) => <button key={value} className={`segmented-button ${precision === value ? 'selected' : ''}`} type="button" aria-pressed={precision === value} onClick={() => setPrecision(value)}>{label}</button>)}
          </div>
          <div className="toolbar-divider" />
          <label className="check-option"><input type="checkbox" checked={!showSame} onChange={(event) => setShowSame(!event.target.checked)} /><span>{tr('隐藏相同行', 'Hide unchanged lines')}</span></label>
          <label className="check-option"><input type="checkbox" checked={wrapLines} onChange={(event) => setWrapLines(event.target.checked)} /><span>{tr('结果自动换行', 'Wrap result lines')}</span></label>
          <div className="toolbar-spacer" />
          <span className="diff-position">{diffRowIds.length ? `${selectedDiff + 1} / ${diffRowIds.length}` : '0 / 0'}</span>
          <button className="icon-button" type="button" title={tr('上一处差异', 'Previous difference')} aria-label={tr('上一处差异', 'Previous difference')} disabled={!diffRowIds.length} onClick={() => jump(-1)}><ChevronUp size={17} /></button>
          <button className="icon-button" type="button" title={tr('下一处差异', 'Next difference')} aria-label={tr('下一处差异', 'Next difference')} disabled={!diffRowIds.length} onClick={() => jump(1)}><ChevronDown size={17} /></button>
        </div>
        {diffRowIds.length > 0 && (
          <div className="merge-toolbar">
            <span>{tr('当前差异块', 'Current difference')}</span>
            <button type="button" onClick={() => merge('left-to-right')}><Copy size={14} /> {tr('复制到右侧', 'Copy to right')} <ArrowRight size={14} /></button>
            <button type="button" onClick={() => merge('right-to-left')}><ArrowRight className="flipped" size={14} /> {tr('复制到左侧', 'Copy to left')}</button>
          </div>
        )}
        <div className={`diff-view ${view} ${wrapLines ? 'wrap-lines' : ''}`}>
          {rows.length === 0 ? (
            <div className="empty-result"><FileCode2 size={28} /><strong>{tr('没有可显示的文本行', 'No text lines to display')}</strong><span>{tr('两个文件均为空。', 'Both files are empty.')}</span></div>
          ) : diffRowIds.length === 0 ? (
            <div className="empty-result success"><Check size={28} /><strong>{tr('内容完全一致', 'Content is identical')}</strong><span>{tr('当前选项下没有发现差异。', 'No differences were found with the current options.')}</span></div>
          ) : view === 'split' ? (
            <div className="diff-lines">
              <div className="diff-column-head"><span>{displayName(comparison.leftName, comparison.leftUntitled)}</span><span>{displayName(comparison.rightName, comparison.rightUntitled)}</span></div>
              {visibleRows.map((row) => (
                <div id={`${diffRowPrefix}-diff-row-${row.id}`} key={row.id} className={`diff-line status-${row.status} ${activeRowId === row.id ? 'active' : ''}`} onClick={() => { const next = diffRowIds.indexOf(row.id); if (next >= 0) setActiveDiff(next) }}>
                  <div className={`diff-side left status-${row.status}`}><span className="line-num">{row.leftNumber ?? ''}</span><span className="line-mark">{row.status === 'added' || row.status === 'same' ? '' : '−'}</span><code><DiffCode row={row} side="left" ignoreEolFormat={comparison.ignoreWhitespace} precision={precision} /></code></div>
                  <div className={`diff-side right status-${row.status}`}><span className="line-num">{row.rightNumber ?? ''}</span><span className="line-mark">{row.status === 'removed' || row.status === 'same' ? '' : '+'}</span><code><DiffCode row={row} side="right" ignoreEolFormat={comparison.ignoreWhitespace} precision={precision} /></code></div>
                </div>
              ))}
            </div>
          ) : (
            <div className="unified-lines">
              {visibleRows.flatMap((row) => {
                if (row.status === 'same') return [<div className="unified-line same" key={`${row.id}-same`}><span className="line-num">{row.leftNumber}</span><span className="line-num">{row.rightNumber}</span><span className="line-mark" /><code>{row.left || ' '}</code></div>]
                const out = []
                if (row.left !== undefined) out.push(<div id={`${diffRowPrefix}-diff-row-${row.id}`} className={`unified-line removed ${activeRowId === row.id ? 'active' : ''}`} key={`${row.id}-left`} onClick={() => setActiveDiff(diffRowIds.indexOf(row.id))}><span className="line-num">{row.leftNumber}</span><span className="line-num" /><span className="line-mark">−</span><code><DiffCode row={row} side="left" ignoreEolFormat={comparison.ignoreWhitespace} precision={precision} /></code></div>)
                if (row.right !== undefined) out.push(<div id={row.left === undefined ? `${diffRowPrefix}-diff-row-${row.id}` : undefined} className={`unified-line added ${activeRowId === row.id ? 'active' : ''}`} key={`${row.id}-right`} onClick={() => setActiveDiff(diffRowIds.indexOf(row.id))}><span className="line-num" /><span className="line-num">{row.rightNumber}</span><span className="line-mark">+</span><code><DiffCode row={row} side="right" ignoreEolFormat={comparison.ignoreWhitespace} precision={precision} /></code></div>)
                return out
              })}
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  )
}
