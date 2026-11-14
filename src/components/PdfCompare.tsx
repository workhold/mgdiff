import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeftRight, ArrowRight, Check, ChevronLeft, ChevronRight, FileText, Layers3, RotateCcw, ScanSearch, Type } from 'lucide-react'
import FileDropzone from './FileDropzone'
import { comparePdfVisualPages, parsePdf, renderPdfComparisonPage, type PdfData, type PdfDiffRegion, type PdfPagePreview, type PdfVisualComparison } from '../lib/pdf'
import { buildTextDiff } from '../lib/text'
import type { HistoryRecordInput } from '../lib/history'
import { useLanguage } from '../i18n'

type DisplayError = string | { zh: string; en: string }

function errorText(error: DisplayError, tr: (zh: string, en: string) => string) {
  return typeof error === 'string' ? error : tr(error.zh, error.en)
}

function paintPage(
  target: HTMLCanvasElement | null,
  source: HTMLCanvasElement | null,
  overlay: HTMLCanvasElement | null,
  showHighlights: boolean,
  selectedRegion: PdfDiffRegion | null,
) {
  if (!target || !source) return
  target.width = source.width
  target.height = source.height
  const context = target.getContext('2d')
  if (!context) return
  context.drawImage(source, 0, 0)
  if (showHighlights && overlay) context.drawImage(overlay, 0, 0)
  if (showHighlights && selectedRegion) {
    const x = selectedRegion.x * target.width
    const y = selectedRegion.y * target.height
    const width = selectedRegion.width * target.width
    const height = selectedRegion.height * target.height
    context.save()
    context.strokeStyle = '#087e78'
    context.lineWidth = Math.max(4, Math.round(target.width / 240))
    context.setLineDash([12, 7])
    context.strokeRect(x, y, width, height)
    context.restore()
  }
}

function regionLocation(region: PdfDiffRegion, tr: (zh: string, en: string) => string): string {
  const vertical = region.y + region.height / 2
  const horizontal = region.x + region.width / 2
  const verticalLabel = vertical < 0.33 ? tr('上方', 'top') : vertical > 0.67 ? tr('下方', 'bottom') : tr('中部', 'middle')
  const horizontalLabel = horizontal < 0.33 ? tr('左侧', 'left') : horizontal > 0.67 ? tr('右侧', 'right') : tr('中间', 'center')
  return `${verticalLabel} · ${horizontalLabel}`
}

type Props = { initialFiles?: { leftFile: File; rightFile: File }; autoCompare?: boolean; recordAutoCompare?: boolean; onCompared?: (record: HistoryRecordInput) => void; onFileNameChange?: (fileName: string | null) => void }

export default function PdfCompare({ initialFiles, autoCompare = false, recordAutoCompare = false, onCompared, onFileNameChange }: Props) {
  const { tr } = useLanguage()
  const rootRef = useRef<HTMLDivElement>(null)
  const onFileNameChangeRef = useRef(onFileNameChange)
  onFileNameChangeRef.current = onFileNameChange
  const [leftFile, setLeftFile] = useState<File | null>(initialFiles?.leftFile ?? null)
  const [rightFile, setRightFile] = useState<File | null>(initialFiles?.rightFile ?? null)
  const [resultFiles, setResultFiles] = useState<{ leftFile: File; rightFile: File } | null>(null)
  const [showResult, setShowResult] = useState(false)
  const [leftData, setLeftData] = useState<PdfData | null>(null)
  const [rightData, setRightData] = useState<PdfData | null>(null)
  const [visual, setVisual] = useState<PdfVisualComparison | null>(null)
  const [page, setPage] = useState(1)
  const [tab, setTab] = useState<'preview' | 'text'>('preview')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<DisplayError>('')
  const [showHighlights, setShowHighlights] = useState(true)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<DisplayError>('')
  const [previewRegions, setPreviewRegions] = useState<PdfDiffRegion[]>([])
  const [selectedRegionNumber, setSelectedRegionNumber] = useState<number | null>(null)
  const leftCanvas = useRef<HTMLCanvasElement>(null)
  const rightCanvas = useRef<HTMLCanvasElement>(null)
  const previewRef = useRef<PdfPagePreview | null>(null)
  const showHighlightsRef = useRef(showHighlights)
  const autoStarted = useRef(false)
  const compareToken = useRef(0)
  showHighlightsRef.current = showHighlights

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
      const [left, right, visualResult] = await Promise.all([
        parsePdf(files.leftFile), parsePdf(files.rightFile), comparePdfVisualPages(files.leftFile, files.rightFile),
      ])
      if (token !== compareToken.current) return
      setLeftData(left)
      setRightData(right)
      setVisual(visualResult)
      setResultFiles(files)
      setPage(1)
      setTab('preview')
      previewRef.current = null
      setShowResult(true)
      if (record) onCompared?.({ mode: 'pdf', leftName: files.leftFile.name, rightName: files.rightFile.name, summary: `${visualResult.changedPages} 页不同`, payload: { kind: 'files', ...files } })
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause)
      if (token === compareToken.current) setError({ zh: `PDF 比对失败：${detail}`, en: `PDF comparison failed: ${detail}` })
    } finally {
      if (token === compareToken.current) setLoading(false)
    }
  }

  useEffect(() => {
    if (!showResult || tab !== 'preview' || !visual || !resultFiles) return
    let cancelled = false
    previewRef.current = null
    setPreviewLoading(true)
    setPreviewError('')
    setPreviewRegions([])
    setSelectedRegionNumber(null)
    if (leftCanvas.current) leftCanvas.current.width = 0
    if (rightCanvas.current) rightCanvas.current.width = 0
    void renderPdfComparisonPage(resultFiles.leftFile, resultFiles.rightFile, page)
      .then((preview) => {
        if (cancelled) return
        previewRef.current = preview
        setPreviewRegions(preview.regions)
        paintPage(leftCanvas.current, preview.left, preview.leftOverlay, showHighlightsRef.current, null)
        paintPage(rightCanvas.current, preview.right, preview.rightOverlay, showHighlightsRef.current, null)
      })
      .catch(() => {
        if (!cancelled) setPreviewError({ zh: '页面预览失败，请重试。', en: 'Unable to preview the page. Please retry.' })
      })
      .finally(() => { if (!cancelled) setPreviewLoading(false) })
    return () => { cancelled = true }
  }, [tab, visual, resultFiles, page, showResult])

  useEffect(() => {
    const preview = previewRef.current
    if (!preview || tab !== 'preview') return
    const selectedRegion = preview.regions.find((region) => region.number === selectedRegionNumber) ?? null
    paintPage(leftCanvas.current, preview.left, preview.leftOverlay, showHighlights, selectedRegion)
    paintPage(rightCanvas.current, preview.right, preview.rightOverlay, showHighlights, selectedRegion)
  }, [showHighlights, selectedRegionNumber, tab])

  const textRows = useMemo(() => buildTextDiff(leftData?.pages[page - 1]?.text ?? '', rightData?.pages[page - 1]?.text ?? '', { ignoreWhitespace: false, ignoreCase: false }), [leftData, rightData, page])
  const changedTextRows = textRows.filter((row) => row.status !== 'same')
  const currentPage = visual?.pages[page - 1]

  return (
    <div ref={rootRef} className={`mode-content ${showResult ? 'comparison-stage--result' : ''}`}>
      {!showResult && (
      <div className="workspace-card">
        <div className="card-titlebar"><div><div className="eyebrow">{tr('选择文档', 'Choose documents')}</div><h2>{tr('对比两个 PDF 文件', 'Compare two PDF files')}</h2></div><span className="format-hint">{tr('包括扫描件与页面视觉差异', 'Includes scanned documents and visual page differences')}</span></div>
        <div className="file-pair-grid">
          <div><div className="file-side-label"><span className="side-dot left" /> {tr('原始 PDF', 'Original PDF')}</div><FileDropzone side="left" file={leftFile} accept=".pdf,application/pdf" hint={tr('拖入 PDF 文件', 'Drop a PDF file')} onFile={(file) => chooseFile('left', file)} /></div>
          <div><div className="file-side-label"><span className="side-dot right" /> {tr('修改后 PDF', 'Modified PDF')}</div><FileDropzone side="right" file={rightFile} accept=".pdf,application/pdf" hint={tr('拖入 PDF 文件', 'Drop a PDF file')} onFile={(file) => chooseFile('right', file)} /></div>
        </div>
        {error && <div className="inline-error" role="alert">{errorText(error, tr)}</div>}
        <div className="compare-action-bar"><span>{tr('选择两个 PDF 文件后开始逐页比对。', 'Choose two PDF files to compare them page by page.')}</span><button className="button button-primary compare-start-button" type="button" disabled={!leftFile || !rightFile || loading} onClick={() => void startCompare()}>{loading ? tr('正在解析并比对…', 'Parsing and comparing…') : tr('开始比对', 'Compare')} <ArrowRight size={16} /></button></div>
      </div>
      )}

      {showResult && resultFiles && (
      <div className="workspace-card result-card pdf-result">
        <div className="compare-result-header"><div><div className="eyebrow">{tr('PDF 对比结果', 'PDF comparison results')}</div><div className="compare-result-names"><span title={resultFiles.leftFile.name}>{resultFiles.leftFile.name}</span><ArrowLeftRight size={16} /><span title={resultFiles.rightFile.name}>{resultFiles.rightFile.name}</span></div></div><div className="compare-result-actions"><button className="button button-secondary" type="button" onClick={() => { ++compareToken.current; setLoading(false); setShowResult(false) }}>{tr('返回修改', 'Back to edit')}</button><button className="button button-primary" type="button" disabled={loading} onClick={() => void startCompare()}><RotateCcw size={15} /> {loading ? tr('正在比对…', 'Comparing…') : tr('重新比对', 'Compare again')}</button></div></div>
        {error && <div className="inline-error" role="alert">{errorText(error, tr)}</div>}
        <div className="card-titlebar result-titlebar"><div><div className="eyebrow">{tr('文档差异', 'Document differences')}</div><h2>{tr('PDF 对比结果', 'PDF comparison results')} {visual && <span className="result-count">{tr(`${visual.changedPages} 页不同`, visual.changedPages === 1 ? '1 page differs' : `${visual.changedPages} pages differ`)}</span>}</h2></div></div>
        {visual ? (
          <>
            <div className="result-summary">
              <div className="summary-stat modified"><ScanSearch size={17} /><strong>{visual.changedPages}</strong><span>{tr('差异页', 'Changed pages')}</span></div>
              <div className="summary-stat total"><FileText size={17} /><strong>{leftData?.pages.length ?? 0}</strong><span>{tr('原始页数', 'Original pages')}</span></div>
              <div className="summary-stat total"><FileText size={17} /><strong>{rightData?.pages.length ?? 0}</strong><span>{tr('修改后页数', 'Modified pages')}</span></div>
            </div>
            {visual.changedPages === 0 && <div className="pdf-success-banner"><Check size={16} /> {tr('所有页面的视觉内容均未检测到差异', 'No visual differences were found on any page')}</div>}
            <div className="pdf-workspace">
                <aside className="pdf-page-list" aria-label={tr('页面列表', 'Page list')}>
                  <div className="pdf-page-list__title">{tr('页面', 'Pages')} <span>{visual.pages.length}</span></div>
                  {visual.pages.map((item) => <button key={item.number} type="button" className={`pdf-page-item ${page === item.number ? 'selected' : ''}`} onClick={() => setPage(item.number)}><span className="pdf-page-num">{item.number}</span><span>{tr(`第 ${item.number} 页`, `Page ${item.number}`)}</span><span className={`status-pill ${item.status}`}>{statusLabel(item.status, tr)}</span></button>)}
                </aside>
                <div className="pdf-detail">
                  <div className="pdf-detail-toolbar">
                    <div className="toolbar-group"><button className={`segmented-button ${tab === 'preview' ? 'selected' : ''}`} type="button" onClick={() => setTab('preview')}><ScanSearch size={15} /> {tr('页面预览', 'Page preview')}</button><button className={`segmented-button ${tab === 'text' ? 'selected' : ''}`} type="button" onClick={() => setTab('text')}><Type size={15} /> {tr('文本差异', 'Text differences')}</button></div>
                    {tab === 'preview' && <button className={`segmented-button ${showHighlights ? 'selected' : ''}`} type="button" aria-pressed={showHighlights} onClick={() => setShowHighlights((value) => !value)}><Layers3 size={15} /> {tr('差异高亮', 'Highlight differences')}</button>}
                    <div className="toolbar-spacer" />
                    <span className="pdf-page-info">{tr(`第 ${page} / ${visual.pages.length} 页`, `Page ${page} / ${visual.pages.length}`)} {currentPage?.status === 'changed' && <span>{tr(`· 约 ${(currentPage.differenceRatio * 100).toFixed(1)}% 像素变化`, `· About ${(currentPage.differenceRatio * 100).toFixed(1)}% of pixels changed`)}</span>}</span>
                    <button className="icon-button" type="button" aria-label={tr('上一页', 'Previous page')} disabled={page === 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={17} /></button>
                    <button className="icon-button" type="button" aria-label={tr('下一页', 'Next page')} disabled={page === visual.pages.length} onClick={() => setPage((value) => value + 1)}><ChevronRight size={17} /></button>
                  </div>
                  {tab === 'preview' ? (
                    <>
                      {previewLoading && <div className="pdf-page-info" role="status" style={{ padding: '8px 12px' }}>{tr(`正在定位第 ${page} 页的视觉差异…`, `Locating visual differences on page ${page}…`)}</div>}
                      {previewError && <div className="inline-error" role="alert">{errorText(previewError, tr)}</div>}
                      {showHighlights && !previewLoading && previewRegions.length > 0 && (
                        <div className="pdf-diff-regions" aria-label={tr('视觉差异区域', 'Visual difference regions')}>
                          <strong>{tr(`差异区域 ${previewRegions.length} 处`, `${previewRegions.length} difference ${previewRegions.length === 1 ? 'region' : 'regions'}`)}</strong>
                          {previewRegions.slice(0, 20).map((region) => (
                            <button
                              key={region.number}
                              type="button"
                              className={`segmented-button ${selectedRegionNumber === region.number ? 'selected' : ''}`}
                              aria-pressed={selectedRegionNumber === region.number}
                              onClick={() => setSelectedRegionNumber((current) => current === region.number ? null : region.number)}
                              title={tr(`区域 ${region.number}，${regionLocation(region, tr)}`, `Region ${region.number}, ${regionLocation(region, tr)}`)}
                            >
                              {region.number} · {regionLocation(region, tr)}
                            </button>
                          ))}
                          {previewRegions.length > 20 && <span className="pdf-page-info">{tr(`另有 ${previewRegions.length - 20} 处，已在页面上标出`, `${previewRegions.length - 20} more ${previewRegions.length - 20 === 1 ? 'region is' : 'regions are'} marked on the page`)}</span>}
                        </div>
                      )}
                      <div className="pdf-preview-grid">
                        <div><div className="pdf-preview-label"><span className="side-dot left" /> {tr(`原始 · 第 ${page} 页`, `Original · Page ${page}`)}</div><div className="pdf-page-canvas">{page <= (leftData?.pages.length ?? 0) ? <canvas ref={leftCanvas} /> : <span>{tr('此侧无对应页面', 'No corresponding page on this side')}</span>}</div></div>
                        <div><div className="pdf-preview-label"><span className="side-dot right" /> {tr(`修改后 · 第 ${page} 页`, `Modified · Page ${page}`)}</div><div className="pdf-page-canvas">{page <= (rightData?.pages.length ?? 0) ? <canvas ref={rightCanvas} /> : <span>{tr('此侧无对应页面', 'No corresponding page on this side')}</span>}</div></div>
                      </div>
                    </>
                  ) : (
                    <div className="pdf-text-diff">
                      {changedTextRows.length ? changedTextRows.slice(0, 300).map((row) => <div className="pdf-text-row" key={row.id}>{row.left !== undefined && <div className="removed"><span>−</span>{row.left}</div>}{row.right !== undefined && <div className="added"><span>+</span>{row.right}</div>}</div>) : <div className="pdf-text-empty">{tr('此页未提取到文本变化。若内容是图片，请查看页面预览。', 'No text changes were extracted from this page. If the content is an image, check the page preview.')}</div>}
                    </div>
                  )}
                </div>
            </div>
          </>
        ) : <div className="empty-result"><FileText size={29} /><strong>{tr('暂无比较结果', 'No comparison results yet')}</strong></div>}
      </div>
      )}
    </div>
  )
}

function statusLabel(status: 'same' | 'changed' | 'left-only' | 'right-only', tr: (zh: string, en: string) => string) {
  if (status === 'same') return tr('相同', 'Same')
  if (status === 'changed') return tr('不同', 'Changed')
  if (status === 'left-only') return tr('仅原始', 'Original only')
  return tr('仅修改', 'Modified only')
}
