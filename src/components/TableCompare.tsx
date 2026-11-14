import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, ArrowLeftRight, ArrowRight, Check, FileSpreadsheet, Filter, RotateCcw, Table2 } from 'lucide-react'
import FileDropzone from './FileDropzone'
import Dropdown from './Dropdown'
import { compareTableSheets, parseTable, type TableAlignment, type TableData, type TableComparisonRow } from '../lib/table'
import { saveTextFile } from '../lib/files'
import type { HistoryRecordInput } from '../lib/history'
import { useLanguage } from '../i18n'

type Props = { initialFiles?: { leftFile: File; rightFile: File }; autoCompare?: boolean; recordAutoCompare?: boolean; onCompared?: (record: HistoryRecordInput) => void; onFileNameChange?: (fileName: string | null) => void }

export default function TableCompare({ initialFiles, autoCompare = false, recordAutoCompare = false, onCompared, onFileNameChange }: Props) {
  const { tr } = useLanguage()
  const rootRef = useRef<HTMLDivElement>(null)
  const onFileNameChangeRef = useRef(onFileNameChange)
  onFileNameChangeRef.current = onFileNameChange
  const [leftFile, setLeftFile] = useState<File | null>(initialFiles?.leftFile ?? null)
  const [rightFile, setRightFile] = useState<File | null>(initialFiles?.rightFile ?? null)
  const [resultFiles, setResultFiles] = useState<{ leftFile: File; rightFile: File } | null>(null)
  const [showResult, setShowResult] = useState(false)
  const [leftData, setLeftData] = useState<TableData | null>(null)
  const [rightData, setRightData] = useState<TableData | null>(null)
  const [sheetIndex, setSheetIndex] = useState(0)
  const [onlyChanged, setOnlyChanged] = useState(false)
  const [alignment, setAlignment] = useState<TableAlignment>('first-column')
  const [compareFormulas, setCompareFormulas] = useState(true)
  const [usedAlignment, setUsedAlignment] = useState<TableAlignment>('first-column')
  const [usedCompareFormulas, setUsedCompareFormulas] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const autoStarted = useRef(false)
  const compareToken = useRef(0)

  const selectedFileName = leftFile?.name ?? rightFile?.name ?? null
  useEffect(() => {
    onFileNameChangeRef.current?.(selectedFileName)
  }, [selectedFileName])

  function chooseFile(side: 'left' | 'right', file: File | null) {
    ++compareToken.current
    setLoading(false)
    setError('')
    if (side === 'left') setLeftFile(file)
    else setRightFile(file)
  }

  useEffect(() => {
    if (autoCompare && initialFiles && !autoStarted.current) {
      autoStarted.current = true
      void startCompare(initialFiles, recordAutoCompare)
    }
    // History replay mounts this component with a new key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    rootRef.current?.closest('.main-scroll')?.scrollTo(0, 0)
  }, [showResult])

  async function startCompare(files = leftFile && rightFile ? { leftFile, rightFile } : null, record = true) {
    if (!files || loading) return
    const token = ++compareToken.current
    setError('')
    setLoading(true)
    try {
      const [left, right] = await Promise.all([parseTable(files.leftFile), parseTable(files.rightFile)])
      if (token !== compareToken.current) return
      setLeftData(left)
      setRightData(right)
      setResultFiles(files)
      setUsedAlignment(alignment)
      setUsedCompareFormulas(compareFormulas)
      setSheetIndex(0)
      setShowResult(true)
      if (record) {
        const firstLeft = left.sheets[0]
        const firstRight = right.sheets.length === 1 ? right.sheets[0] : right.sheets.find((sheet) => sheet.name === firstLeft?.name)
        const summary = compareTableSheets(firstLeft?.rows ?? [], firstRight?.rows ?? [], { alignment, compareFormulas, leftFormulas: firstLeft?.formulas, rightFormulas: firstRight?.formulas })
        onCompared?.({ mode: 'table', leftName: files.leftFile.name, rightName: files.rightFile.name, summary: `${summary.changedCells} 个单元格不同`, payload: { kind: 'files', ...files } })
      }
    } catch (cause) {
      if (token === compareToken.current) setError(cause instanceof Error && cause.message.startsWith('Unsupported table format: ')
        ? cause.message : '表格解析失败')
    } finally {
      if (token === compareToken.current) setLoading(false)
    }
  }

  const sheetPairs = useMemo(() => {
    if (!leftData || !rightData) return []
    if (leftData.sheets.length === 1 && rightData.sheets.length === 1) {
      return [{ name: '数据表', left: leftData.sheets[0], right: rightData.sheets[0] }]
    }
    const names = [...new Set([...leftData.sheets.map((sheet) => sheet.name), ...rightData.sheets.map((sheet) => sheet.name)])]
    return names.map((name) => ({ name, left: leftData.sheets.find((sheet) => sheet.name === name), right: rightData.sheets.find((sheet) => sheet.name === name) }))
  }, [leftData, rightData])
  const leftSheet = sheetPairs[sheetIndex]?.left
  const rightSheet = sheetPairs[sheetIndex]?.right
  const sheetMismatch = !!leftData && !!rightData && (!leftSheet || !rightSheet)
  const result = useMemo(() => leftData && rightData ? compareTableSheets(leftSheet?.rows ?? [], rightSheet?.rows ?? [], {
    alignment: usedAlignment,
    compareFormulas: usedCompareFormulas,
    leftFormulas: leftSheet?.formulas,
    rightFormulas: rightSheet?.formulas,
  }) : null, [leftData, rightData, leftSheet, rightSheet, usedAlignment, usedCompareFormulas])
  const visibleRows = result?.rows.filter((row) => !onlyChanged || row.status !== 'same') ?? []
  const columnCount = (result?.rows ?? []).reduce((count, row) => Math.max(count, row.left.length, row.right.length), 1)
  const columns = Array.from({ length: columnCount }, (_, index) => index)
  const sheetCount = sheetPairs.length
  const unsupportedFormat = error.match(/^Unsupported table format: (.*)\. Use \.csv, \.tsv, or \.xlsx\.$/)
  const displayError = error === '表格解析失败'
    ? tr('表格解析失败', 'Failed to parse table')
    : unsupportedFormat
      ? tr(`不支持的表格格式：${unsupportedFormat[1]}。请使用 .csv、.tsv 或 .xlsx 文件。`, error)
      : error
  const displayAlignmentWarning = result?.alignmentWarning === '首列没有可用键，已改为按行号对齐。'
    ? tr('首列没有可用键，已改为按行号对齐。', 'No usable keys in the first column; rows were aligned by position instead.')
    : result?.alignmentWarning === '首列有空值或重复键；相关行优先按完整内容匹配，其余按出现顺序对齐。'
      ? tr('首列有空值或重复键；相关行优先按完整内容匹配，其余按出现顺序对齐。', 'The first column has empty or duplicate keys. Related rows were matched by full content first, then by occurrence order.')
      : result?.alignmentWarning

  function formulaAt(side: 'left' | 'right', row: TableComparisonRow, column: number): string {
    const sourceIndex = side === 'left' ? row.leftIndex : row.rightIndex
    const sheet = side === 'left' ? leftSheet : rightSheet
    return sourceIndex === undefined ? '' : sheet?.formulas[sourceIndex]?.[column] ?? ''
  }

  function exportReport() {
    if (!result) return
    const lines = [
      `${tr('表格对比报告', 'Table comparison report')}: ${resultFiles?.leftFile.name} ↔ ${resultFiles?.rightFile.name}`,
      `${tr('工作表', 'Sheet')}: ${leftSheet?.name ?? '—'} ↔ ${rightSheet?.name ?? '—'}`,
      `${tr('行对齐', 'Row alignment')}: ${result.alignmentUsed === 'first-column' ? tr('按首列键', 'By first-column key') : tr('按行号', 'By row number')} | ${usedCompareFormulas ? tr('包含公式差异', 'Include formula differences') : tr('仅显示值', 'Values only')}`,
      `${tr('差异行', 'Changed rows')}: ${result.changedRows} | ${tr('差异单元格', 'Changed cells')}: ${result.changedCells}${sheetMismatch ? ` | ${tr('一侧缺少该工作表', 'Sheet missing on one side')}` : ''}`,
      '',
      ...result.rows.filter((row) => row.status !== 'same').map((row) => [
        `${row.status === 'left-only' ? tr('仅原始', 'Original only') : row.status === 'right-only' ? tr('仅修改后', 'Modified only') : tr('修改', 'Changed')} · ${tr(`原始第 ${row.leftIndex === undefined ? '—' : row.leftIndex + 1} 行`, `Original row ${row.leftIndex === undefined ? '—' : row.leftIndex + 1}`)} ↔ ${tr(`修改后第 ${row.rightIndex === undefined ? '—' : row.rightIndex + 1} 行`, `Modified row ${row.rightIndex === undefined ? '—' : row.rightIndex + 1}`)}`,
        `  ${tr('原始', 'Original')}: ${row.left.join(' | ')}`,
        `  ${tr('修改', 'Modified')}: ${row.right.join(' | ')}`,
        ...row.formulaChangedColumns.map((column) =>
          `  ${columnLabel(column)} ${tr('列公式', 'column formula')}: ${formulaAt('left', row, column) || '—'} → ${formulaAt('right', row, column) || '—'}`,
        ),
      ].join('\n')),
    ]
    void saveTextFile(lines.join('\n'), 'table-diff-report.txt')
  }

  return (
    <div ref={rootRef} className={`mode-content ${showResult ? 'comparison-stage--result' : ''}`}>
      {!showResult && (
      <div className="workspace-card">
        <div className="card-titlebar"><div><div className="eyebrow">{tr('选择表格', 'Select tables')}</div><h2>{tr('对比两个表格文件', 'Compare two table files')}</h2></div><span className="format-hint">{tr('支持 .xlsx、.csv、.tsv', 'Supports .xlsx, .csv, .tsv')}</span></div>
        <div className="file-pair-grid">
          <div><div className="file-side-label"><span className="side-dot left" /> {tr('原始表格', 'Original table')}</div><FileDropzone side="left" file={leftFile} accept=".xlsx,.csv,.tsv" hint={tr('拖入 XLSX、CSV 或 TSV 文件', 'Drop an XLSX, CSV, or TSV file')} onFile={(file) => chooseFile('left', file)} /></div>
          <div><div className="file-side-label"><span className="side-dot right" /> {tr('修改后表格', 'Modified table')}</div><FileDropzone side="right" file={rightFile} accept=".xlsx,.csv,.tsv" hint={tr('拖入 XLSX、CSV 或 TSV 文件', 'Drop an XLSX, CSV, or TSV file')} onFile={(file) => chooseFile('right', file)} /></div>
        </div>
        <div className="compare-options"><div className="select-label">{tr('行对齐', 'Row alignment')}<Dropdown value={alignment} onChange={(value) => setAlignment(value as TableAlignment)} ariaLabel={tr('行对齐', 'Row alignment')} options={[{ value: 'first-column', label: tr('按首列键', 'By first-column key') }, { value: 'index', label: tr('按行号', 'By row number') }]} /></div><label className="check-option"><input type="checkbox" checked={compareFormulas} onChange={(event) => setCompareFormulas(event.target.checked)} /><span>{tr('对比公式', 'Compare formulas')}</span></label></div>
        {error && <div className="inline-error" role="alert">{displayError}</div>}
        <div className="compare-action-bar"><span>{tr('选择两个表格文件后开始比对。', 'Choose two table files to start comparing.')}</span><button className="button button-primary compare-start-button" type="button" disabled={!leftFile || !rightFile || loading} onClick={() => void startCompare()}>{loading ? tr('正在解析表格…', 'Parsing tables…') : tr('开始比对', 'Compare')} <ArrowRight size={16} /></button></div>
      </div>
      )}

      {showResult && resultFiles && (
      <div className="workspace-card result-card table-result">
        <div className="compare-result-header"><div><div className="eyebrow">{tr('表格对比结果', 'Table comparison result')}</div><div className="compare-result-names"><span title={resultFiles.leftFile.name}>{resultFiles.leftFile.name}</span><ArrowLeftRight size={16} /><span title={resultFiles.rightFile.name}>{resultFiles.rightFile.name}</span></div></div><div className="compare-result-actions"><button className="button button-secondary" type="button" onClick={() => { ++compareToken.current; setLoading(false); setShowResult(false) }}>{tr('返回修改', 'Back to editing')}</button><button className="button button-primary" type="button" disabled={loading} onClick={() => void startCompare()}><RotateCcw size={15} /> {loading ? tr('正在比对…', 'Comparing…') : tr('重新比对', 'Compare again')}</button></div></div>
        {error && <div className="inline-error" role="alert">{displayError}</div>}
        <div className="card-titlebar result-titlebar">
          <div><div className="eyebrow">{tr('单元格差异', 'Cell differences')}</div><h2>{tr('表格对比结果', 'Table comparison result')} {result && <span className="result-count">{sheetMismatch ? `${tr('工作表缺失', 'Sheet missing')} · ` : ''}{result.changedCells} {tr('个单元格不同', result.changedCells === 1 ? 'cell differs' : 'cells differ')}{result.changedFormulaCells > 0 ? ` · ${result.changedFormulaCells} ${tr('处公式变化', result.changedFormulaCells === 1 ? 'formula change' : 'formula changes')}` : ''}</span>}</h2></div>
          <button className="button button-secondary" type="button" disabled={!result} onClick={exportReport}><ArrowDownToLine size={15} /> {tr('导出报告', 'Export report')}</button>
        </div>
        {result && (
          <>
            <div className="result-summary">
              <div className="summary-stat modified"><Table2 size={17} /><strong>{result.changedRows}</strong><span>{tr('差异行', 'Changed rows')}</span></div>
              <div className="summary-stat added"><span className="summary-sign">▦</span><strong>{result.changedCells}</strong><span>{tr('差异单元格', 'Changed cells')}</span></div>
              <div className="summary-stat total"><FileSpreadsheet size={17} /><strong>{result.rows.length}</strong><span>{tr('总行数', 'Total rows')}</span></div>
              <div className="summary-stat total"><FileSpreadsheet size={17} /><strong>{sheetCount}</strong><span>{tr('工作表', 'Sheets')}</span></div>
            </div>
            <div className="result-toolbar">
              <div className="select-label">{tr('工作表', 'Sheet')}
                <Dropdown value={String(sheetIndex)} onChange={(value) => setSheetIndex(Number(value))} ariaLabel={tr('工作表', 'Sheet')} options={sheetPairs.map((pair, index) => ({ value: String(index), label: `${pair.left?.name ?? '—'} ↔ ${pair.right?.name ?? '—'}` }))} />
              </div>
              <div className="toolbar-spacer" />
              <label className="check-option"><input type="checkbox" checked={onlyChanged} onChange={(event) => setOnlyChanged(event.target.checked)} /><Filter size={15} /><span>{tr('仅显示差异', 'Show differences only')}</span></label>
            </div>
            {sheetMismatch && <div className="sheet-warning">{leftSheet ? tr('此工作表只存在于原始表格中。', 'This sheet exists only in the original table.') : tr('此工作表只存在于修改后表格中。', 'This sheet exists only in the modified table.')}</div>}
            {result.alignmentWarning && <div className="sheet-warning">{displayAlignmentWarning}</div>}
            {result.changedCells === 0 && !sheetMismatch ? (
              <div className="empty-result success"><Check size={28} /><strong>{tr('表格内容一致', 'Table contents match')}</strong><span>{tr('当前工作表未发现单元格差异。', 'No cell differences were found in this sheet.')}</span></div>
            ) : (
              <div className="table-compare-scroll">
                <div className="table-pair">
                  {(['left', 'right'] as const).map((side) => (
                    <div className="table-pane" key={side}>
                      <div className="table-pane__title"><span className={`side-dot ${side}`} />{side === 'left' ? (leftSheet?.name ?? tr('原始表格', 'Original table')) : (rightSheet?.name ?? tr('修改后表格', 'Modified table'))}</div>
                      <table className="compare-table"><thead><tr><th className="row-head">#</th>{columns.map((column) => <th key={column}>{columnLabel(column)}</th>)}</tr></thead>
                        <tbody>{visibleRows.map((row) => {
                          const sourceIndex = side === 'left' ? row.leftIndex : row.rightIndex
                          return <tr key={row.index} className={row.status !== 'same' ? 'has-change' : undefined}>
                            <th className="row-head" title={row.status === 'left-only' ? tr('仅原始存在', 'Only in original') : row.status === 'right-only' ? tr('仅修改后存在', 'Only in modified') : undefined}>
                              {sourceIndex === undefined ? '—' : sourceIndex + 1}
                              {row.status === 'left-only' && side === 'left' ? ' −' : row.status === 'right-only' && side === 'right' ? ' +' : ''}
                            </th>
                            {columns.map((column) => {
                              const value = (side === 'left' ? row.left : row.right)[column] ?? ''
                              const formula = formulaAt(side, row, column)
                              const formulaChanged = row.formulaChangedColumns.includes(column)
                              return <td key={column} className={row.changedColumns.includes(column) ? `changed-${side}` : undefined} title={formula ? `${tr('显示值', 'Displayed value')}: ${value}\n${tr('公式', 'Formula')}: ${formula}` : value}>
                                {value || <span className="cell-empty">—</span>}{formulaChanged && <sup title={`${tr('公式', 'Formula')}: ${formula || tr('无', 'None')}`}> ƒ</sup>}
                              </td>
                            })}
                          </tr>
                        })}</tbody>
                      </table>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
      )}
    </div>
  )
}

function columnLabel(index: number): string {
  let result = ''
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + (value - 1) % 26) + result
  return result
}
