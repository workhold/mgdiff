export interface FolderComparisonEntry {
  path: string
  status: 'same' | 'changed' | 'left-only' | 'right-only'
  left?: File
  right?: File
}

function relativePath(file: File): string {
  const selectedPath = (file.webkitRelativePath || '').replace(/\\/g, '/')
  const segments = selectedPath.split('/').filter(Boolean)
  // A directory picker includes the selected folder's own name in every path.
  return segments.length > 1 ? segments.slice(1).join('/') : file.name
}

async function sameContents(left: File, right: File): Promise<boolean> {
  if (left.size !== right.size) return false

  const chunkSize = 1024 * 1024
  for (let offset = 0; offset < left.size; offset += chunkSize) {
    const [leftBuffer, rightBuffer] = await Promise.all([
      left.slice(offset, offset + chunkSize).arrayBuffer(),
      right.slice(offset, offset + chunkSize).arrayBuffer(),
    ])
    const leftBytes = new Uint8Array(leftBuffer)
    const rightBytes = new Uint8Array(rightBuffer)
    for (let index = 0; index < leftBytes.length; index += 1) {
      if (leftBytes[index] !== rightBytes[index]) return false
    }
  }

  return true
}

/** Compares files from two directory picker selections by relative path and bytes. */
export async function compareFolderFiles(
  leftFiles: File[],
  rightFiles: File[],
): Promise<FolderComparisonEntry[]> {
  const leftByPath = new Map(leftFiles.map((file) => [relativePath(file), file]))
  const rightByPath = new Map(rightFiles.map((file) => [relativePath(file), file]))
  const paths = [...new Set([...leftByPath.keys(), ...rightByPath.keys()])].sort((a, b) =>
    a.localeCompare(b),
  )
  const entries = new Array<FolderComparisonEntry>(paths.length)
  let next = 0

  // Bound concurrent reads so large folders do not allocate all file buffers at once.
  await Promise.all(
    Array.from({ length: Math.min(4, paths.length) }, async () => {
      while (next < paths.length) {
        const index = next++
        const path = paths[index]
        const left = leftByPath.get(path)
        const right = rightByPath.get(path)
        const status = !left
          ? 'right-only'
          : !right
            ? 'left-only'
            : (await sameContents(left, right))
              ? 'same'
              : 'changed'
        entries[index] = { path, status, left, right }
      }
    }),
  )

  return entries
}
