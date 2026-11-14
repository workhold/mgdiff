import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

type PdfDocument = Awaited<ReturnType<typeof getDocument>['promise']>
type PdfPage = Awaited<ReturnType<PdfDocument['getPage']>>

export interface PdfData {
  pages: { number: number; text: string }[]
}

export interface PdfVisualPage {
  number: number
  status: 'same' | 'changed' | 'left-only' | 'right-only'
  /** Fraction of visibly different pixels, from 0 to 1; page size changes report 1. */
  differenceRatio: number
}

export interface PdfVisualComparison {
  pages: PdfVisualPage[]
  changedPages: number
}

/** Page-relative coordinates in the 0–1 range. */
export interface PdfDiffRegion {
  number: number
  x: number
  y: number
  width: number
  height: number
  changedPixels: number
}

export interface PdfPagePreview {
  left: HTMLCanvasElement | null
  right: HTMLCanvasElement | null
  leftOverlay: HTMLCanvasElement | null
  rightOverlay: HTMLCanvasElement | null
  regions: PdfDiffRegion[]
  differenceRatio: number
}

const PIXEL_TOLERANCE = 16
// The overview and the selected-page overlay must inspect the same pixels.
// A lower overview resolution can miss thin marks that the preview highlights.
const VISUAL_COMPARE_MAX_DIMENSION = 1600

async function openPdf(file: File): Promise<PdfDocument> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  return getDocument({ data: bytes }).promise
}

// External diff tools use an empty file for a path that does not exist on one side.
// PDF.js cannot open that placeholder, so treat it as a document with no pages.
async function openPdfIfPresent(file: File): Promise<PdfDocument | null> {
  return file.size === 0 ? null : openPdf(file)
}

/** Extracts text in PDF.js reading order, with one entry per page. */
export async function parsePdf(file: File): Promise<PdfData> {
  const pdf = await openPdfIfPresent(file)
  if (!pdf) return { pages: [] }
  try {
    const pages: PdfData['pages'] = []
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number)
      const pieces: string[] = []
      // Some macOS WebViews do not expose ReadableStream's async iterator,
      // which PDF.js getTextContent() uses internally. The reader API works there.
      const reader = page.streamTextContent().getReader()
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          for (const item of value.items) {
            if ('str' in item) {
              pieces.push(item.str)
              pieces.push(item.hasEOL ? '\n' : ' ')
            }
          }
        }
      } finally {
        reader.releaseLock()
      }
      pages.push({
        number,
        text: pieces.join('').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim(),
      })
    }
    return { pages }
  } finally {
    await pdf.destroy()
  }
}

async function drawPage(page: PdfPage, canvas: HTMLCanvasElement, maxDimension: number): Promise<void> {
  const naturalViewport = page.getViewport({ scale: 1 })
  const scale = Math.min(1.5, maxDimension / Math.max(naturalViewport.width, naturalViewport.height))
  const viewport = page.getViewport({ scale })
  canvas.width = Math.max(1, Math.ceil(viewport.width))
  canvas.height = Math.max(1, Math.ceil(viewport.height))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Canvas 2D rendering is unavailable.')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvas, canvasContext: context, viewport }).promise
}

/** Renders a 1-based page number to the supplied canvas. */
export async function renderPdfPage(
  file: File,
  pageNumber: number,
  canvas: HTMLCanvasElement,
): Promise<void> {
  const pdf = await openPdf(file)
  try {
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.numPages) {
      throw new RangeError(`Page ${pageNumber} is outside this PDF's 1–${pdf.numPages} page range.`)
    }
    // PDF.js must never render two tasks into the same visible canvas at once.
    const rendered = document.createElement('canvas')
    await drawPage(await pdf.getPage(pageNumber), rendered, 2400)
    copyCanvas(rendered, canvas)
  } finally {
    await pdf.destroy()
  }
}

function copyCanvas(source: HTMLCanvasElement, target: HTMLCanvasElement): void {
  target.width = source.width
  target.height = source.height
  const context = target.getContext('2d')
  if (!context) throw new Error('Canvas 2D rendering is unavailable.')
  context.drawImage(source, 0, 0)
}

async function pagePixels(page: PdfPage): Promise<ImageData> {
  const canvas = document.createElement('canvas')
  await drawPage(page, canvas, VISUAL_COMPARE_MAX_DIMENSION)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Canvas 2D pixel reading is unavailable.')
  return context.getImageData(0, 0, canvas.width, canvas.height)
}

function pixelDifferenceRatio(left: ImageData, right: ImageData): number {
  if (left.width !== right.width || left.height !== right.height) return 1
  let changedPixels = 0
  for (let offset = 0; offset < left.data.length; offset += 4) {
    if (
      Math.abs(left.data[offset] - right.data[offset]) > PIXEL_TOLERANCE ||
      Math.abs(left.data[offset + 1] - right.data[offset + 1]) > PIXEL_TOLERANCE ||
      Math.abs(left.data[offset + 2] - right.data[offset + 2]) > PIXEL_TOLERANCE ||
      Math.abs(left.data[offset + 3] - right.data[offset + 3]) > PIXEL_TOLERANCE
    ) {
      changedPixels += 1
    }
  }
  return changedPixels / (left.width * left.height)
}

function emptyOverlay(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function fullPageOverlay(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const overlay = emptyOverlay(canvas.width, canvas.height)
  const context = overlay.getContext('2d')
  if (!context) throw new Error('Canvas 2D rendering is unavailable.')
  context.fillStyle = 'rgba(220, 54, 48, 0.14)'
  context.fillRect(0, 0, overlay.width, overlay.height)
  context.strokeStyle = 'rgba(197, 42, 39, 0.95)'
  context.lineWidth = Math.max(2, Math.round(overlay.width / 500))
  context.strokeRect(2, 2, overlay.width - 4, overlay.height - 4)
  return overlay
}

function buildDiffOverlay(left: HTMLCanvasElement, right: HTMLCanvasElement): {
  overlay: HTMLCanvasElement
  regions: PdfDiffRegion[]
  differenceRatio: number
} {
  const width = left.width
  const height = left.height
  const leftContext = left.getContext('2d', { willReadFrequently: true })
  const rightContext = right.getContext('2d', { willReadFrequently: true })
  if (!leftContext || !rightContext) throw new Error('Canvas 2D pixel reading is unavailable.')
  const leftPixels = leftContext.getImageData(0, 0, width, height).data
  const rightPixels = rightContext.getImageData(0, 0, width, height).data
  const overlay = emptyOverlay(width, height)
  const overlayContext = overlay.getContext('2d')
  if (!overlayContext) throw new Error('Canvas 2D rendering is unavailable.')
  const mask = overlayContext.createImageData(width, height)
  const tileSize = Math.max(8, Math.ceil(Math.max(width, height) / 100))
  const columns = Math.ceil(width / tileSize)
  const rows = Math.ceil(height / tileSize)
  const tileCounts = new Uint32Array(columns * rows)
  let changedPixels = 0

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      if (
        Math.abs(leftPixels[offset] - rightPixels[offset]) <= PIXEL_TOLERANCE &&
        Math.abs(leftPixels[offset + 1] - rightPixels[offset + 1]) <= PIXEL_TOLERANCE &&
        Math.abs(leftPixels[offset + 2] - rightPixels[offset + 2]) <= PIXEL_TOLERANCE &&
        Math.abs(leftPixels[offset + 3] - rightPixels[offset + 3]) <= PIXEL_TOLERANCE
      ) continue
      changedPixels += 1
      tileCounts[Math.floor(y / tileSize) * columns + Math.floor(x / tileSize)] += 1
      mask.data[offset] = 220
      mask.data[offset + 1] = 54
      mask.data[offset + 2] = 48
      mask.data[offset + 3] = 125
    }
  }
  overlayContext.putImageData(mask, 0, 0)
  if (changedPixels === 0) return { overlay, regions: [], differenceRatio: 0 }

  // Join nearby changed tiles so a word or graphic becomes one readable region.
  const expanded = new Uint8Array(tileCounts.length)
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (!tileCounts[row * columns + column]) continue
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nextRow = row + dy
          const nextColumn = column + dx
          if (nextRow >= 0 && nextRow < rows && nextColumn >= 0 && nextColumn < columns) {
            expanded[nextRow * columns + nextColumn] = 1
          }
        }
      }
    }
  }

  const visited = new Uint8Array(tileCounts.length)
  const regions: PdfDiffRegion[] = []
  for (let start = 0; start < expanded.length; start += 1) {
    if (!expanded[start] || visited[start]) continue
    const queue = [start]
    visited[start] = 1
    let minColumn = columns
    let minRow = rows
    let maxColumn = 0
    let maxRow = 0
    let regionPixels = 0
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const index = queue[cursor]
      const row = Math.floor(index / columns)
      const column = index % columns
      if (tileCounts[index]) {
        regionPixels += tileCounts[index]
        minColumn = Math.min(minColumn, column)
        minRow = Math.min(minRow, row)
        maxColumn = Math.max(maxColumn, column)
        maxRow = Math.max(maxRow, row)
      }
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nextRow = row + dy
          const nextColumn = column + dx
          const next = nextRow * columns + nextColumn
          if (nextRow < 0 || nextRow >= rows || nextColumn < 0 || nextColumn >= columns || !expanded[next] || visited[next]) continue
          visited[next] = 1
          queue.push(next)
        }
      }
    }
    if (!regionPixels) continue
    const x = Math.max(0, minColumn * tileSize - tileSize / 2)
    const y = Math.max(0, minRow * tileSize - tileSize / 2)
    const rightEdge = Math.min(width, (maxColumn + 1) * tileSize + tileSize / 2)
    const bottomEdge = Math.min(height, (maxRow + 1) * tileSize + tileSize / 2)
    regions.push({
      number: 0,
      x: x / width,
      y: y / height,
      width: (rightEdge - x) / width,
      height: (bottomEdge - y) / height,
      changedPixels: regionPixels,
    })
  }
  regions.sort((a, b) => a.y - b.y || a.x - b.x)
  for (let index = 0; index < regions.length; index += 1) {
    const region = regions[index]
    region.number = index + 1
    const x = region.x * width
    const y = region.y * height
    const regionWidth = region.width * width
    const regionHeight = region.height * height
    overlayContext.fillStyle = 'rgba(220, 54, 48, 0.06)'
    overlayContext.fillRect(x, y, regionWidth, regionHeight)
    overlayContext.strokeStyle = 'rgba(197, 42, 39, 0.94)'
    overlayContext.lineWidth = Math.max(2, Math.round(width / 500))
    overlayContext.strokeRect(x, y, regionWidth, regionHeight)
    if (index < 20) {
      const label = String(region.number)
      overlayContext.font = `bold ${Math.max(12, Math.round(width / 65))}px sans-serif`
      const labelWidth = overlayContext.measureText(label).width + 12
      const labelHeight = Math.max(18, Math.round(width / 46))
      overlayContext.fillStyle = '#c52a27'
      overlayContext.fillRect(x, Math.max(0, y - labelHeight), labelWidth, labelHeight)
      overlayContext.fillStyle = '#fff'
      overlayContext.fillText(label, x + 6, Math.max(labelHeight - 4, y - 5))
    }
  }
  return { overlay, regions, differenceRatio: changedPixels / (width * height) }
}

/** Renders both sides on isolated canvases and produces page-relative visual highlights. */
export async function renderPdfComparisonPage(
  leftFile: File,
  rightFile: File,
  pageNumber: number,
): Promise<PdfPagePreview> {
  if (!Number.isInteger(pageNumber) || pageNumber < 1) throw new RangeError('Page number must be positive.')
  const leftPdf = await openPdfIfPresent(leftFile)
  let rightPdf: PdfDocument | null = null
  try {
    rightPdf = await openPdfIfPresent(rightFile)
    const leftPageCount = leftPdf?.numPages ?? 0
    const rightPageCount = rightPdf?.numPages ?? 0
    if (pageNumber > Math.max(leftPageCount, rightPageCount)) {
      throw new RangeError(`Page ${pageNumber} is outside both PDFs.`)
    }
    const [leftPage, rightPage] = await Promise.all([
      leftPdf && pageNumber <= leftPageCount ? leftPdf.getPage(pageNumber) : Promise.resolve(null),
      rightPdf && pageNumber <= rightPageCount ? rightPdf.getPage(pageNumber) : Promise.resolve(null),
    ])
    const left = leftPage ? document.createElement('canvas') : null
    const right = rightPage ? document.createElement('canvas') : null
    await Promise.all([
      left && leftPage ? drawPage(leftPage, left, VISUAL_COMPARE_MAX_DIMENSION) : Promise.resolve(),
      right && rightPage ? drawPage(rightPage, right, VISUAL_COMPARE_MAX_DIMENSION) : Promise.resolve(),
    ])
    const leftSize = leftPage?.getViewport({ scale: 1 })
    const rightSize = rightPage?.getViewport({ scale: 1 })
    const pageSizeChanged = leftSize && rightSize && (
      Math.abs(leftSize.width - rightSize.width) > 0.01 ||
      Math.abs(leftSize.height - rightSize.height) > 0.01
    )
    if (!left || !right || pageSizeChanged || left.width !== right.width || left.height !== right.height) {
      return {
        left,
        right,
        leftOverlay: left ? fullPageOverlay(left) : null,
        rightOverlay: right ? fullPageOverlay(right) : null,
        regions: [{ number: 1, x: 0, y: 0, width: 1, height: 1, changedPixels: 0 }],
        differenceRatio: 1,
      }
    }
    const result = buildDiffOverlay(left, right)
    return {
      left,
      right,
      leftOverlay: result.overlay,
      rightOverlay: result.overlay,
      regions: result.regions,
      differenceRatio: result.differenceRatio,
    }
  } finally {
    await Promise.all([leftPdf?.destroy(), rightPdf?.destroy()])
  }
}

/** Detects visual changes, including changes on scanned or image-only pages. */
export async function comparePdfVisualPages(
  leftFile: File,
  rightFile: File,
): Promise<PdfVisualComparison> {
  const leftPdf = await openPdfIfPresent(leftFile)
  let rightPdf: PdfDocument | null = null
  try {
    rightPdf = await openPdfIfPresent(rightFile)
    const leftPageCount = leftPdf?.numPages ?? 0
    const rightPageCount = rightPdf?.numPages ?? 0
    const pages: PdfVisualPage[] = []
    let changedPages = 0

    for (let number = 1; number <= Math.max(leftPageCount, rightPageCount); number += 1) {
      if (number > leftPageCount) {
        pages.push({ number, status: 'right-only', differenceRatio: 1 })
        changedPages += 1
      } else if (number > rightPageCount) {
        pages.push({ number, status: 'left-only', differenceRatio: 1 })
        changedPages += 1
      } else {
        // Both documents must exist when this page is present on both sides.
        if (!leftPdf || !rightPdf) throw new Error('PDF page state is inconsistent.')
        const [leftPage, rightPage] = await Promise.all([
          leftPdf.getPage(number),
          rightPdf.getPage(number),
        ])
        const leftSize = leftPage.getViewport({ scale: 1 })
        const rightSize = rightPage.getViewport({ scale: 1 })
        if (
          Math.abs(leftSize.width - rightSize.width) > 0.01 ||
          Math.abs(leftSize.height - rightSize.height) > 0.01
        ) {
          pages.push({ number, status: 'changed', differenceRatio: 1 })
          changedPages += 1
          continue
        }
        const [leftPixels, rightPixels] = await Promise.all([
          pagePixels(leftPage),
          pagePixels(rightPage),
        ])
        const differenceRatio = pixelDifferenceRatio(leftPixels, rightPixels)
        const status = differenceRatio === 0 ? 'same' : 'changed'
        if (status === 'changed') changedPages += 1
        pages.push({ number, status, differenceRatio })
      }
    }

    return { pages, changedPages }
  } finally {
    await Promise.all([leftPdf?.destroy(), rightPdf?.destroy()])
  }
}
