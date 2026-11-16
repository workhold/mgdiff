import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import {
  ArrowLeftRight,
  ArrowRight,
  Columns2,
  Download,
  Image as ImageIcon,
  Layers,
  RotateCcw,
  ScanSearch,
  SlidersHorizontal,
  Upload,
  X,
} from 'lucide-react'
import { saveBinaryFile } from '../lib/files'
import type { HistoryRecordInput } from '../lib/history'
import { useWorkspaceState } from '../lib/workspace-state'
import { displayFileName, useLanguage } from '../i18n'
import './image-compare.css'

type Side = 'left' | 'right'
type ViewMode = 'side-by-side' | 'overlay' | 'wipe' | 'difference' | 'subtract' | 'flicker'

type ImageAsset = {
  file: File
  image: HTMLImageElement
  url: string
  width: number
  height: number
}

type Comparison = {
  width: number
  height: number
  leftUrl: string
  rightUrl: string
  differenceUrl: string
  subtractionUrl: string
  changedPercent: number
  changedPixels: number
  totalPixels: number
}

const modes: { id: ViewMode; zh: string; en: string; icon: typeof Columns2 }[] = [
  { id: 'side-by-side', zh: '并排', en: 'Side by side', icon: Columns2 },
  { id: 'overlay', zh: '叠加', en: 'Overlay', icon: Layers },
  { id: 'wipe', zh: '滑块', en: 'Wipe', icon: SlidersHorizontal },
  { id: 'difference', zh: '差异', en: 'Difference', icon: ScanSearch },
  { id: 'subtract', zh: '相减', en: 'Subtract', icon: Layers },
  { id: 'flicker', zh: '闪烁', en: 'Flicker', icon: ImageIcon },
]

class ImageCompareError extends Error {
  constructor(message: string, readonly english: string) {
    super(message)
  }
}

function errorText(error: Error | string, tr: (zh: string, en: string) => string) {
  return error instanceof ImageCompareError ? tr(error.message, error.english) : error instanceof Error ? tr('图片处理失败', 'Image processing failed') : error
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function imageToCanvas(asset: ImageAsset, width: number, height: number, scale: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new ImageCompareError('当前环境无法创建图像画布', 'Unable to create an image canvas in this environment')
  ctx.clearRect(0, 0, width, height)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  const x = (width - asset.width * scale) / 2
  const y = (height - asset.height * scale) / 2
  ctx.drawImage(asset.image, x, y, asset.width * scale, asset.height * scale)
  return { canvas, ctx }
}

function compareImages(left: ImageAsset, right: ImageAsset, tolerance: number): Comparison {
  const sourceWidth = Math.max(left.width, right.width)
  const sourceHeight = Math.max(left.height, right.height)
  const scale = Math.min(
    1,
    1400 / sourceWidth,
    1400 / sourceHeight,
    Math.sqrt(1_600_000 / (sourceWidth * sourceHeight)),
  )
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))
  const a = imageToCanvas(left, width, height, scale)
  const b = imageToCanvas(right, width, height, scale)
  const leftPixels = a.ctx.getImageData(0, 0, width, height)
  const rightPixels = b.ctx.getImageData(0, 0, width, height)
  const heatmap = a.ctx.createImageData(width, height)
  const subtraction = a.ctx.createImageData(width, height)
  let changedPixels = 0

  for (let index = 0; index < leftPixels.data.length; index += 4) {
    const leftAlpha = leftPixels.data[index + 3] / 255
    const rightAlpha = rightPixels.data[index + 3] / 255
    const r = leftPixels.data[index]
    const g = leftPixels.data[index + 1]
    const bl = leftPixels.data[index + 2]
    const leftLuminance = (r * 0.2126 + g * 0.7152 + bl * 0.0722) * leftAlpha
    const rightLuminance = (
      rightPixels.data[index] * 0.2126 +
      rightPixels.data[index + 1] * 0.7152 +
      rightPixels.data[index + 2] * 0.0722
    ) * rightAlpha
    const distance = Math.max(
      Math.abs(leftAlpha - rightAlpha) * 255,
      (Math.abs(r * leftAlpha - rightPixels.data[index] * rightAlpha) +
        Math.abs(g * leftAlpha - rightPixels.data[index + 1] * rightAlpha) +
        Math.abs(bl * leftAlpha - rightPixels.data[index + 2] * rightAlpha)) / 3,
    )
    const effectiveTolerance = tolerance * (0.5 + Math.max(leftLuminance, rightLuminance) / 510)
    const changed = distance > effectiveTolerance
    if (changed) changedPixels += 1
    const tone = Math.round(30 + leftLuminance * 0.16)
    heatmap.data[index] = changed ? 255 : tone
    heatmap.data[index + 1] = changed ? 71 : tone + 6
    heatmap.data[index + 2] = changed ? 87 : tone + 10
    heatmap.data[index + 3] = 255
    const intensity = Math.min(255, Math.round(distance * 4))
    subtraction.data[index] = intensity
    subtraction.data[index + 1] = intensity
    subtraction.data[index + 2] = intensity
    subtraction.data[index + 3] = 255
  }

  const differenceCanvas = document.createElement('canvas')
  differenceCanvas.width = width
  differenceCanvas.height = height
  const differenceContext = differenceCanvas.getContext('2d')
  if (!differenceContext) throw new ImageCompareError('当前环境无法绘制差异图', 'Unable to draw the difference image in this environment')
  differenceContext.putImageData(heatmap, 0, 0)
  const subtractionCanvas = document.createElement('canvas')
  subtractionCanvas.width = width
  subtractionCanvas.height = height
  const subtractionContext = subtractionCanvas.getContext('2d')
  if (!subtractionContext) throw new ImageCompareError('当前环境无法绘制相减视图', 'Unable to draw the subtraction view in this environment')
  subtractionContext.putImageData(subtraction, 0, 0)
  const totalPixels = width * height

  return {
    width,
    height,
    leftUrl: a.canvas.toDataURL('image/png'),
    rightUrl: b.canvas.toDataURL('image/png'),
    differenceUrl: differenceCanvas.toDataURL('image/png'),
    subtractionUrl: subtractionCanvas.toDataURL('image/png'),
    changedPercent: (changedPixels / totalPixels) * 100,
    changedPixels,
    totalPixels,
  }
}

function loadImage(file: File, url: string): Promise<ImageAsset> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      if (!image.naturalWidth || !image.naturalHeight) {
        reject(new ImageCompareError('无法读取图片尺寸', 'Unable to read image dimensions'))
        return
      }
      resolve({
        file,
        image,
        url,
        width: image.naturalWidth,
        height: image.naturalHeight,
      })
    }
    image.onerror = () => reject(new ImageCompareError('无法打开该图片，请换用 PNG、JPG 或 WebP 文件', 'Unable to open this image. Try a PNG, JPG, or WebP file.'))
    image.src = url
  })
}

type Props = { initialFiles?: { leftFile: File; rightFile: File }; autoCompare?: boolean; recordAutoCompare?: boolean; onCompared?: (record: HistoryRecordInput) => void; onFileNameChange?: (fileName: string | null) => void; active?: boolean }

export default function ImageCompare({ initialFiles, autoCompare = false, recordAutoCompare = false, onCompared, onFileNameChange, active = true }: Props) {
  const { tr, language } = useLanguage()
  const rootRef = useRef<HTMLElement>(null)
  const onFileNameChangeRef = useRef(onFileNameChange)
  onFileNameChangeRef.current = onFileNameChange
  const [leftFile, setLeftFile] = useWorkspaceState<File | null>('image.leftFile', initialFiles?.leftFile ?? null)
  const [rightFile, setRightFile] = useWorkspaceState<File | null>('image.rightFile', initialFiles?.rightFile ?? null)
  const [left, setLeft] = useState<ImageAsset | null>(null)
  const [right, setRight] = useState<ImageAsset | null>(null)
  const leftSelectedName = leftFile?.name ?? null
  const rightSelectedName = rightFile?.name ?? null
  const [view, setView] = useWorkspaceState<ViewMode>('image.view', 'side-by-side')
  const [flickerRight, setFlickerRight] = useState(false)
  const [opacity, setOpacity] = useWorkspaceState('image.opacity', 50)
  const [split, setSplit] = useWorkspaceState('image.split', 50)
  const [tolerance, setTolerance] = useWorkspaceState('image.tolerance', 12)
  const [comparison, setComparison] = useState<Comparison | null>(null)
  const [resultAssets, setResultAssets] = useState<{ left: ImageAsset; right: ImageAsset; tolerance: number } | null>(null)
  const [showResult, setShowResult] = useState(false)
  const [restoreResult, setRestoreResult] = useWorkspaceState('image.showResult', false)
  const [computing, setComputing] = useState(false)
  const [error, setError] = useState<Error | string>('')
  const [dragging, setDragging] = useState<Side | null>(null)
  const leftInput = useRef<HTMLInputElement>(null)
  const rightInput = useRef<HTMLInputElement>(null)
  const urls = useRef<Record<Side, string | null>>({ left: null, right: null })
  const loadToken = useRef<Record<Side, number>>({ left: 0, right: 0 })
  const compareToken = useRef(0)

  const selectedFileName = leftSelectedName ?? rightSelectedName
  useEffect(() => {
    onFileNameChangeRef.current?.(selectedFileName)
  }, [selectedFileName])

  useEffect(() => {
    return () => {
      ++loadToken.current.left
      ++loadToken.current.right
      ++compareToken.current
      if (urls.current.left) URL.revokeObjectURL(urls.current.left)
      if (urls.current.right) URL.revokeObjectURL(urls.current.right)
    }
  }, [])

  const acceptFile = useCallback(async (side: Side, file: File | undefined) => {
    if (!file) return
    ++compareToken.current
    setComputing(false)
    setRestoreResult(false)
    if (!file.type.startsWith('image/')) {
      setError(new ImageCompareError('请选择图片文件（如 PNG、JPG、WebP 或 GIF）', 'Choose an image file, such as PNG, JPG, WebP, or GIF.'))
      return
    }
    if (side === 'left') setLeftFile(file)
    else setRightFile(file)
    const token = ++loadToken.current[side]
    if (urls.current[side]) URL.revokeObjectURL(urls.current[side])
    urls.current[side] = null
    if (side === 'left') setLeft(null)
    else setRight(null)
    const url = URL.createObjectURL(file)
    setError('')
    try {
      const asset = await loadImage(file, url)
      if (token !== loadToken.current[side]) {
        URL.revokeObjectURL(url)
        return
      }
      if (urls.current[side]) URL.revokeObjectURL(urls.current[side])
      urls.current[side] = url
      if (side === 'left') setLeft(asset)
      else setRight(asset)
    } catch (cause) {
      URL.revokeObjectURL(url)
      if (token === loadToken.current[side]) {
        if (side === 'left') setLeftFile((current) => current === file ? null : current)
        else setRightFile((current) => current === file ? null : current)
        setError(cause instanceof ImageCompareError ? cause : new ImageCompareError('图片加载失败', 'Failed to load image'))
      }
    }
  }, [setLeftFile, setRightFile, setRestoreResult])

  useEffect(() => {
    const initialLeft = autoCompare && initialFiles ? initialFiles.leftFile : leftFile
    const initialRight = autoCompare && initialFiles ? initialFiles.rightFile : rightFile
    if (!initialLeft && !initialRight) return
    let cancelled = false
    const leftUrl = initialLeft ? URL.createObjectURL(initialLeft) : null
    const rightUrl = initialRight ? URL.createObjectURL(initialRight) : null
    void Promise.all([
      initialLeft && leftUrl ? loadImage(initialLeft, leftUrl) : Promise.resolve(null),
      initialRight && rightUrl ? loadImage(initialRight, rightUrl) : Promise.resolve(null),
    ])
      .then(([leftAsset, rightAsset]) => {
        if (cancelled) return
        if (leftAsset) { urls.current.left = leftUrl; setLeft(leftAsset) }
        if (rightAsset) { urls.current.right = rightUrl; setRight(rightAsset) }
        if (leftAsset && rightAsset && (autoCompare || restoreResult)) {
          void startCompare({ left: leftAsset, right: rightAsset }, autoCompare ? recordAutoCompare : false)
        }
      })
      .catch((cause: unknown) => {
        if (leftUrl && urls.current.left !== leftUrl) URL.revokeObjectURL(leftUrl)
        if (rightUrl && urls.current.right !== rightUrl) URL.revokeObjectURL(rightUrl)
        if (!cancelled) setError(cause instanceof ImageCompareError ? cause : new ImageCompareError('图片加载失败', 'Failed to load image'))
      })
    return () => {
      cancelled = true
      if (leftUrl && urls.current.left !== leftUrl) URL.revokeObjectURL(leftUrl)
      if (rightUrl && urls.current.right !== rightUrl) URL.revokeObjectURL(rightUrl)
    }
    // Persisted Files need fresh image elements and object URLs after restart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    rootRef.current?.closest('.main-scroll')?.scrollTo(0, 0)
  }, [showResult])

  const chooseFile = (side: Side, event: ChangeEvent<HTMLInputElement>) => {
    void acceptFile(side, event.target.files?.[0])
    event.target.value = ''
  }

  const dropFile = (side: Side, event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setDragging(null)
    void acceptFile(side, event.dataTransfer.files[0])
  }

  const clearSide = (side: Side) => {
    ++compareToken.current
    setComputing(false)
    ++loadToken.current[side]
    if (urls.current[side]) URL.revokeObjectURL(urls.current[side])
    urls.current[side] = null
    if (side === 'left') { setLeft(null); setLeftFile(null) }
    else { setRight(null); setRightFile(null) }
    setRestoreResult(false)
    setError('')
  }

  const swapSides = () => {
    ++compareToken.current
    setComputing(false)
    ++loadToken.current.left
    ++loadToken.current.right
    const oldLeftUrl = urls.current.left
    urls.current.left = urls.current.right
    urls.current.right = oldLeftUrl
    setLeft(right)
    setRight(left)
    setLeftFile(rightFile)
    setRightFile(leftFile)
  }

  const setSplitFromPointer = (clientX: number, element: HTMLElement) => {
    const bounds = element.getBoundingClientRect()
    setSplit(Math.max(0, Math.min(100, ((clientX - bounds.left) / bounds.width) * 100)))
  }

  async function startCompare(assets = left && right ? { left, right } : null, record = true) {
    if (!assets || computing) return
    const token = ++compareToken.current
    setComputing(true)
    setError('')
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
    try {
      const result = compareImages(assets.left, assets.right, tolerance)
      if (token !== compareToken.current) return
      setComparison(result)
      setResultAssets({ ...assets, tolerance })
      setShowResult(true)
      setRestoreResult(true)
      if (record) onCompared?.({ mode: 'image', leftName: assets.left.file.name, rightName: assets.right.file.name, summary: `约 ${result.changedPercent.toFixed(1)}% 像素不同`, payload: { kind: 'files', leftFile: assets.left.file, rightFile: assets.right.file } })
    } catch (cause) {
      if (token === compareToken.current) setError(cause instanceof ImageCompareError ? cause : new ImageCompareError('对比图片时发生错误', 'An error occurred while comparing images'))
    } finally {
      if (token === compareToken.current) setComputing(false)
    }
  }

  useEffect(() => {
    if (!active || view !== 'flicker' || !comparison || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timer = window.setInterval(() => setFlickerRight((value) => !value), 650)
    return () => window.clearInterval(timer)
  }, [view, comparison, active])

  async function exportDifference() {
    if (!comparison) return
    try {
      const url = view === 'subtract' ? comparison.subtractionUrl : comparison.differenceUrl
      const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
      await saveBinaryFile(bytes, view === 'subtract' ? 'image-subtraction.png' : 'image-diff.png', 'image/png')
      setError('')
    } catch (cause) {
      setError(cause instanceof ImageCompareError ? cause : new ImageCompareError('导出差异图失败', 'Failed to export the difference image'))
    }
  }

  const sources: { side: Side; label: string; hint: string; asset: ImageAsset | null }[] = [
    { side: 'left', label: tr('原始图片', 'Original image'), hint: tr('拖入原图，或点击选择', 'Drop the original image or click to choose'), asset: left },
    { side: 'right', label: tr('修改图片', 'Modified image'), hint: tr('拖入修改后的图片，或点击选择', 'Drop the modified image or click to choose'), asset: right },
  ]

  return (
    <section ref={rootRef} className={`image-compare ${showResult ? 'comparison-stage--result' : ''}`} aria-label={tr('图片对比', 'Image comparison')}>
      {!showResult && <>
      <header className="image-compare__header">
        <div>
          <span className="image-compare__eyebrow">{tr('选择图片', 'Choose images')}</span>
          <h2>{tr('导入两个版本的图片', 'Import two versions of an image')}</h2>
          <p>{tr('支持叠加、滑块和像素差异高亮。', 'Compare with overlay, wipe, and pixel difference highlighting.')}</p>
        </div>
        <button
          type="button"
          className="image-compare__swap"
          onClick={swapSides}
          disabled={!left && !right}
          title={tr('交换左右图片', 'Swap left and right images')}
        >
          <ArrowLeftRight size={16} />
          {tr('交换图片', 'Swap images')}
        </button>
      </header>

      <div className="image-compare__sources">
        {sources.map(({ side, label, hint, asset }) => (
          <div
            key={side}
            className={
              'image-compare__source' +
              (dragging === side ? ' image-compare__source--dragging' : '')
            }
            onDragEnter={(event) => {
              event.preventDefault()
              setDragging(side)
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                setDragging(null)
              }
            }}
            onDrop={(event) => dropFile(side, event)}
          >
            <div className="image-compare__source-head">
              <div className="image-compare__source-title">
                <span className="image-compare__source-number">{side === 'left' ? '01' : '02'}</span>
                <strong>{label}</strong>
              </div>
              <div className="image-compare__source-actions">
                <button
                  type="button"
                  className="image-compare__text-button"
                  onClick={() => (side === 'left' ? leftInput : rightInput).current?.click()}
                >
                  <Upload size={15} />
                  {tr('选择图片', 'Choose image')}
                </button>
                {(asset || (side === 'left' ? leftFile : rightFile)) && (
                  <button
                    type="button"
                    className="image-compare__icon-button"
                    onClick={() => clearSide(side)}
                    aria-label={tr('移除', 'Remove ') + label}
                    title={tr('移除图片', 'Remove image')}
                  >
                    <X size={15} />
                  </button>
                )}
              </div>
            </div>
            <input
              ref={side === 'left' ? leftInput : rightInput}
              className="image-compare__file-input"
              type="file"
              accept="image/*"
              onChange={(event) => chooseFile(side, event)}
              aria-label={tr('选择', 'Choose ') + label}
            />
            {asset ? (
              <div className="image-compare__preview">
                <div className="image-compare__thumbnail">
                  <img src={asset.url} alt={label + tr('预览', ' preview')} />
                </div>
                <div className="image-compare__file-meta">
                  <strong title={displayFileName(asset.file.name, tr)}>{displayFileName(asset.file.name, tr)}</strong>
                  <span>
                    {asset.width} × {asset.height} px · {formatBytes(asset.file.size)}
                  </span>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="image-compare__dropzone"
                onClick={() => (side === 'left' ? leftInput : rightInput).current?.click()}
              >
                <span className="image-compare__drop-icon">
                  <ImageIcon size={22} />
                </span>
                <strong>{hint}</strong>
                <small>{tr('PNG、JPG、WebP、GIF 等常见格式', 'Common formats such as PNG, JPG, WebP, and GIF')}</small>
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="compare-options image-compare__prepare-options"><label className="image-compare__tolerance"><span>{tr('差异容差', 'Difference tolerance')}</span><input type="range" min="0" max="80" value={tolerance} onChange={(event) => { ++compareToken.current; setComputing(false); setTolerance(Number(event.target.value)) }} aria-label={tr('像素差异容差', 'Pixel difference tolerance')} /><strong>{tolerance}</strong></label></div>

      {error && <p className="image-compare__error" role="alert">{errorText(error, tr)}</p>}
      <div className="compare-action-bar"><span>{tr('选择两张图片后开始像素比对。', 'Choose two images to compare their pixels.')}</span><button className="button button-primary compare-start-button" type="button" disabled={!left || !right || computing} onClick={() => void startCompare()}>{computing ? tr('正在比对…', 'Comparing…') : tr('开始比对', 'Compare')} <ArrowRight size={16} /></button></div>
      </>}

      {showResult && error && (
        <p className="image-compare__error" role="alert">
          {errorText(error, tr)}
        </p>
      )}

      {showResult && resultAssets && <div className="image-compare__result">
        <div className="compare-result-header"><div><div className="eyebrow">{tr('图片对比结果', 'Image comparison results')}</div><div className="compare-result-names"><span title={displayFileName(resultAssets.left.file.name, tr)}>{displayFileName(resultAssets.left.file.name, tr)}</span><ArrowLeftRight size={16} /><span title={displayFileName(resultAssets.right.file.name, tr)}>{displayFileName(resultAssets.right.file.name, tr)}</span></div></div><div className="compare-result-actions"><button className="button button-secondary" type="button" onClick={() => { ++compareToken.current; setComputing(false); setShowResult(false); setRestoreResult(false) }}>{tr('返回修改', 'Back to edit')}</button><button className="button button-primary" type="button" disabled={computing} onClick={() => void startCompare()}><RotateCcw size={15} /> {computing ? tr('正在比对…', 'Comparing…') : tr('重新比对', 'Compare again')}</button></div></div>
        <div className="image-compare__result-head">
          <div className="image-compare__result-title">
            <strong>{tr('对比结果', 'Comparison results')}</strong>
            {comparison && (
              <span className="image-compare__count">
                {tr(`约 ${comparison.changedPercent.toFixed(comparison.changedPercent < 0.1 ? 2 : 1)}% 像素不同`, `About ${comparison.changedPercent.toFixed(comparison.changedPercent < 0.1 ? 2 : 1)}% of pixels differ`)}
              </span>
            )}
          </div>
          {comparison && <button className="image-compare__text-button" type="button" onClick={() => void exportDifference()}><Download size={15} /> {tr('导出差异图', 'Export difference image')}</button>}
          <div className="image-compare__modes" role="tablist" aria-label={tr('对比视图', 'Comparison views')}>
            {modes.map(({ id, zh, en, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={view === id}
                className={'image-compare__mode' + (view === id ? ' image-compare__mode--active' : '')}
                onClick={() => setView(id)}
                disabled={!comparison}
              >
                <Icon size={15} />
                {tr(zh, en)}
              </button>
            ))}
          </div>
        </div>

        {computing ? (
          <div className="image-compare__empty" role="status">
            <span className="image-compare__spinner" />
            <strong>{tr('正在计算像素差异…', 'Calculating pixel differences…')}</strong>
          </div>
        ) : !comparison ? (
          <div className="image-compare__empty" role="status">
            <strong>{tr('暂时无法完成图片对比', 'Unable to compare images right now')}</strong>
            <p>{tr('请重新选择图片后重试。', 'Choose the images again and retry.')}</p>
          </div>
        ) : (
          <>
            {view === 'side-by-side' ? (
              <div className="image-compare__side-view" role="tabpanel">
                <div className="image-compare__pane">
                  <div className="image-compare__pane-label">{tr('原始图片', 'Original image')}</div>
                  <div className="image-compare__image-stage">
                    <img src={comparison.leftUrl} alt={tr('原始图片', 'Original image')} />
                  </div>
                </div>
                <div className="image-compare__pane">
                  <div className="image-compare__pane-label">{tr('修改图片', 'Modified image')}</div>
                  <div className="image-compare__image-stage">
                    <img src={comparison.rightUrl} alt={tr('修改图片', 'Modified image')} />
                  </div>
                </div>
              </div>
            ) : (
              <div className="image-compare__single-view" role="tabpanel">
                <div
                  className={
                    'image-compare__single-stage' +
                    (view === 'wipe' ? ' image-compare__single-stage--wipe' : '') +
                    (view === 'difference' || view === 'subtract' ? ' image-compare__single-stage--difference' : '')
                  }
                  onPointerDown={
                    view === 'wipe'
                      ? (event) => {
                          event.currentTarget.setPointerCapture(event.pointerId)
                          setSplitFromPointer(event.clientX, event.currentTarget)
                        }
                      : undefined
                  }
                  onPointerMove={
                    view === 'wipe'
                      ? (event) => {
                          if (event.buttons === 1) {
                            setSplitFromPointer(event.clientX, event.currentTarget)
                          }
                        }
                      : undefined
                  }
                >
                  {view === 'difference' || view === 'subtract' ? (
                    <img src={view === 'subtract' ? comparison.subtractionUrl : comparison.differenceUrl} alt={view === 'subtract' ? tr('像素相减结果', 'Pixel subtraction result') : tr('红色标记的像素差异', 'Pixel differences marked in red')} />
                  ) : view === 'flicker' ? (
                    <img src={flickerRight ? comparison.rightUrl : comparison.leftUrl} alt={flickerRight ? tr('修改图片', 'Modified image') : tr('原始图片', 'Original image')} />
                  ) : (
                    <>
                      <img src={comparison.leftUrl} alt={tr('原始图片', 'Original image')} />
                      <img
                        src={comparison.rightUrl}
                        alt={tr('修改图片', 'Modified image')}
                        className="image-compare__top-image"
                        style={
                          view === 'overlay'
                            ? { opacity: opacity / 100 }
                            : { clipPath: 'inset(0 ' + (100 - split) + '% 0 0)' }
                        }
                      />
                      {view === 'wipe' && (
                        <span
                          className="image-compare__wipe-line"
                          style={{ left: split + '%' }}
                          aria-hidden="true"
                        >
                          <span>↔</span>
                        </span>
                      )}
                    </>
                  )}
                </div>
                {view === 'overlay' && (
                  <div className="image-compare__slider-row">
                    <span>{tr('原图', 'Original')}</span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={opacity}
                      onChange={(event) => setOpacity(Number(event.target.value))}
                      aria-label={tr('修改图片透明度', 'Modified image opacity')}
                    />
                    <span>{tr(`修改图 ${opacity}%`, `Modified ${opacity}%`)}</span>
                  </div>
                )}
                {view === 'wipe' && (
                  <div className="image-compare__slider-row">
                    <span>{tr('原图', 'Original')}</span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={split}
                      onChange={(event) => setSplit(Number(event.target.value))}
                      aria-label={tr('图片分割位置', 'Image split position')}
                    />
                    <span>{tr('修改图', 'Modified')}</span>
                  </div>
                )}
                {view === 'difference' && (
                  <div className="image-compare__legend">
                    <span className="image-compare__legend-dot" />
                    {tr('红色区域表示超过容差的像素变化', 'Red areas show pixel changes above the tolerance')}
                  </div>
                )}
                {view === 'subtract' && <div className="image-compare__legend">{tr('明亮区域表示两张图片的像素差距。', 'Brighter areas show larger pixel differences between the images.')}</div>}
                {view === 'flicker' && <div className="image-compare__slider-row"><span>{flickerRight ? tr('修改图', 'Modified') : tr('原图', 'Original')}</span><button className="image-compare__text-button" type="button" onClick={() => setFlickerRight((value) => !value)}>{tr('手动切换', 'Switch manually')}</button></div>}
              </div>
            )}
            <div className="image-compare__stats">
              <div>
                <span>{tr('原图尺寸', 'Original dimensions')}</span>
                <strong>{resultAssets.left.width} × {resultAssets.left.height}</strong>
              </div>
              <div>
                <span>{tr('修改图尺寸', 'Modified dimensions')}</span>
                <strong>{resultAssets.right.width} × {resultAssets.right.height}</strong>
              </div>
              <div>
                <span>{tr('变化像素', 'Changed pixels')}</span>
                <strong>{comparison.changedPixels.toLocaleString(language)} / {comparison.totalPixels.toLocaleString(language)}</strong>
              </div>
              <div className="image-compare__tolerance">
                <span>{tr('差异容差', 'Difference tolerance')}</span>
                <strong>{resultAssets.tolerance}</strong>
              </div>
            </div>
            <p className="image-compare__note">
              {tr('像素比例为近似值：大图会缩小采样，不同尺寸的图片会居中放在相同画布上比较。', 'Pixel percentages are approximate: large images are downsampled, and images of different sizes are centered on equal sized canvases for comparison.')}
            </p>
          </>
        )}
      </div>}
    </section>
  )
}
