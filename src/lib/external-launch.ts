import { fileExtension, isTauriApp } from './files'

export class ExternalLaunchError extends Error {
  constructor(message: string, readonly english: string) { super(message) }
}

export type ExternalFileMode = 'text' | 'table' | 'image' | 'pdf'

export interface ExternalFileMeta {
  path: string
  name: string
  exists: boolean
  size: number
  lastModifiedMs: number | null
}

export interface ExternalFolderEntry {
  relativePath: string
  size: number
  hash: string
  absolutePath: string
}

/** Same entry shape as FolderCompare's native folder picker result. */
export interface ExternalFolderSelection {
  folderPath: string
  exists: boolean
  entries: ExternalFolderEntry[]
}

export type ExternalLaunch =
  | {
      kind: 'diff-file'
      mode: ExternalFileMode
      left: File
      right: File
      leftMeta: ExternalFileMeta
      rightMeta: ExternalFileMeta
    }
  | {
      kind: 'diff-directory'
      mode: 'folder'
      left: ExternalFolderSelection
      right: ExternalFolderSelection
    }
  | {
      kind: 'merge'
      mode: 'merge'
      baseText: string
      localText: string
      remoteText: string
      mergedText: string
      baseName: string
      localName: string
      remoteName: string
      mergedName: string
      baseMeta: ExternalFileMeta
      localMeta: ExternalFileMeta
      remoteMeta: ExternalFileMeta
      mergedMeta: ExternalFileMeta
    }

type RawFile = ExternalFileMeta & { bytes: number[] }

type RawExternalLaunch =
  | { kind: 'diff-file'; left: RawFile; right: RawFile }
  | { kind: 'diff-directory'; left: ExternalFolderSelection; right: ExternalFolderSelection }
  | { kind: 'merge'; base: RawFile; local: RawFile; remote: RawFile; merged: RawFile }

function metadata(file: RawFile): ExternalFileMeta {
  const { path, name, exists, size, lastModifiedMs } = file
  return { path, name, exists, size, lastModifiedMs }
}

function hasPrefix(bytes: number[], prefix: number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte)
}

function mimeType(source: RawFile): string {
  switch (fileExtension(source.name)) {
    case 'png': return 'image/png'
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'gif': return 'image/gif'
    case 'webp': return 'image/webp'
    case 'bmp': return 'image/bmp'
    case 'svg': return 'image/svg+xml'
    case 'tif':
    case 'tiff': return 'image/tiff'
    case 'pdf': return 'application/pdf'
    case 'csv': return 'text/csv'
    case 'tsv': return 'text/tab-separated-values'
    case 'xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    default: break
  }
  // Git's temporary pre-image names may not preserve the original extension.
  if (hasPrefix(source.bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'
  if (hasPrefix(source.bytes, [0x89, 0x50, 0x4e, 0x47])) return 'image/png'
  if (hasPrefix(source.bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (hasPrefix(source.bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif'
  if (hasPrefix(source.bytes, [0x42, 0x4d])) return 'image/bmp'
  if (hasPrefix(source.bytes, [0x49, 0x49, 0x2a, 0x00]) || hasPrefix(source.bytes, [0x4d, 0x4d, 0x00, 0x2a])) return 'image/tiff'
  if (hasPrefix(source.bytes, [0x52, 0x49, 0x46, 0x46]) && source.bytes.slice(8, 12).map((byte) => String.fromCharCode(byte)).join('') === 'WEBP') return 'image/webp'
  return 'text/plain'
}

function asFile(source: RawFile): File {
  return new File([new Uint8Array(source.bytes)], source.name, {
    type: mimeType(source),
    lastModified: source.lastModifiedMs ?? Date.now(),
  })
}

function imageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      if (image.naturalWidth && image.naturalHeight) {
        resolve({ width: image.naturalWidth, height: image.naturalHeight })
      } else {
        reject(new ExternalLaunchError(`无法读取图片尺寸：${file.name}`, `Unable to read image dimensions: ${file.name}`))
      }
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new ExternalLaunchError(`无法打开图片：${file.name}`, `Unable to open image: ${file.name}`))
    }
    image.src = url
  })
}

/** A transparent image keeps the existing image comparison views usable for Git's empty side. */
function missingImagePlaceholder(side: 'left' | 'right', width: number, height: number): File {
  const name = side === 'left' ? '__mgdiff_missing_original__.svg' : '__mgdiff_missing_modified__.svg'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"/>`
  return new File([svg], name, { type: 'image/svg+xml' })
}

async function imageFilesWithMissingSides(left: File, right: File, leftPresent: boolean, rightPresent: boolean): Promise<[File, File]> {
  if (leftPresent && rightPresent) return [left, right]
  const dimensions = leftPresent
    ? await imageDimensions(left)
    : rightPresent
      ? await imageDimensions(right)
      : { width: 1, height: 1 }
  return [
    leftPresent ? left : missingImagePlaceholder('left', dimensions.width, dimensions.height),
    rightPresent ? right : missingImagePlaceholder('right', dimensions.width, dimensions.height),
  ]
}

function inferMode(left: RawFile, right: RawFile): ExternalFileMode {
  const extensions = [left.name, right.name, left.path, right.path].map(fileExtension)
  const mimes = [mimeType(left), mimeType(right)]
  if (extensions.includes('pdf') || mimes.includes('application/pdf')) return 'pdf'
  if (extensions.some((extension) => ['xlsx', 'csv', 'tsv'].includes(extension))) return 'table'
  if (extensions.some((extension) => ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'svg'].includes(extension)) || mimes.some((mime) => mime.startsWith('image/'))) return 'image'
  return 'text'
}

function decodeText(source: RawFile, label: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(source.bytes))
  } catch {
    throw new ExternalLaunchError(`${label} 不是 UTF-8 文本，无法在三方合并模式中安全编辑。`, `${label} is not UTF-8 text and cannot be edited safely in three-way merge mode.`)
  }
}

/** Reads the launch snapshot. Browser previews have no external launch. */
export async function getExternalLaunch(): Promise<ExternalLaunch | null> {
  if (!isTauriApp()) return null
  const { invoke } = await import('@tauri-apps/api/core')
  const raw = await invoke<RawExternalLaunch | null>('get_external_launch')
  if (!raw) return null
  if (raw.kind === 'diff-directory') {
    return { kind: 'diff-directory', mode: 'folder', left: raw.left, right: raw.right }
  }
  if (raw.kind === 'diff-file') {
    const mode = inferMode(raw.left, raw.right)
    let left = asFile(raw.left)
    let right = asFile(raw.right)
    if (mode === 'image') {
      // Git can provide an existing but empty temporary file for an absent side.
      const [imageLeft, imageRight] = await imageFilesWithMissingSides(
        left,
        right,
        raw.left.exists && left.size > 0,
        raw.right.exists && right.size > 0,
      )
      left = imageLeft
      right = imageRight
    }
    return {
      kind: 'diff-file',
      mode,
      left,
      right,
      leftMeta: metadata(raw.left),
      rightMeta: metadata(raw.right),
    }
  }
  return {
    kind: 'merge',
    mode: 'merge',
    baseText: decodeText(raw.base, 'BASE'),
    localText: decodeText(raw.local, 'LOCAL'),
    remoteText: decodeText(raw.remote, 'REMOTE'),
    mergedText: decodeText(raw.merged, 'MERGED'),
    baseName: raw.base.name,
    localName: raw.local.name,
    remoteName: raw.remote.name,
    mergedName: raw.merged.name,
    baseMeta: metadata(raw.base),
    localMeta: metadata(raw.local),
    remoteMeta: metadata(raw.remote),
    mergedMeta: metadata(raw.merged),
  }
}

/** Writes only the MERGED path supplied at process launch and marks merge success. */
export async function saveExternalMerge(text: string): Promise<void> {
  if (!isTauriApp()) throw new ExternalLaunchError('外部合并只能在桌面应用中保存。', 'An external merge can only be saved in the desktop app.')
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('save_external_merge', { content: text })
}

/** Absolute executable path for generating Git, SVN, or Hg tool commands. */
export async function getExternalToolPath(): Promise<string | null> {
  if (!isTauriApp()) return null
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<string>('get_external_tool_path')
}
