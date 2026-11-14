import { createPatch, diffArrays, diffChars, diffWordsWithSpace } from 'diff'

export type TextDiffRow = {
  id: number
  leftNumber?: number
  rightNumber?: number
  left?: string
  right?: string
  leftEol?: string
  rightEol?: string
  status: 'same' | 'modified' | 'added' | 'removed'
}

export type TextOptions = { ignoreWhitespace: boolean; ignoreCase: boolean }
export type DiffPrecision = 'smart' | 'word' | 'char'

type TextLine = { content: string; eol: string }

function linesOf(text: string): TextLine[] {
  if (!text) return []
  const lines: TextLine[] = []
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '\r' && text[index] !== '\n') continue
    const eol = text[index] === '\r' && text[index + 1] === '\n' ? '\r\n' : text[index]
    lines.push({ content: text.slice(start, index), eol })
    if (eol === '\r\n') index += 1
    start = index + 1
  }
  if (start < text.length) lines.push({ content: text.slice(start), eol: '' })
  return lines
}

/** Restores line endings after a textarea normalizes its value to LF on edit. */
export function preserveEditedLineEndings(previous: string, edited: string): string {
  const oldLines = linesOf(previous)
  const newLines = linesOf(edited)
  if (!newLines.length) return ''

  const endingCounts = new Map<string, number>()
  for (const line of oldLines) {
    if (line.eol) endingCounts.set(line.eol, (endingCounts.get(line.eol) ?? 0) + 1)
  }
  let preferredEol = '\n'
  let preferredCount = 0
  for (const [eol, count] of endingCounts) {
    if (count > preferredCount) {
      preferredEol = eol
      preferredCount = count
    }
  }

  const endings = new Array<string>(newLines.length)
  const retainEnding = (oldIndex: number | undefined, newIndex: number) => {
    if (!newLines[newIndex].eol) {
      endings[newIndex] = ''
    } else {
      endings[newIndex] = (oldIndex === undefined ? '' : oldLines[oldIndex].eol) || preferredEol
    }
  }
  const chunks = diffArrays(oldLines.map((line) => line.content), newLines.map((line) => line.content))
  let oldIndex = 0
  let newIndex = 0
  for (let chunkIndex = 0; chunkIndex < chunks.length;) {
    const chunk = chunks[chunkIndex]
    if (!chunk.added && !chunk.removed) {
      for (let count = 0; count < chunk.value.length; count += 1) {
        retainEnding(oldIndex++, newIndex++)
      }
      chunkIndex += 1
      continue
    }

    let removedCount = 0
    let addedCount = 0
    while (chunkIndex < chunks.length && (chunks[chunkIndex].added || chunks[chunkIndex].removed)) {
      if (chunks[chunkIndex].removed) removedCount += chunks[chunkIndex].value.length
      if (chunks[chunkIndex].added) addedCount += chunks[chunkIndex].value.length
      chunkIndex += 1
    }
    // When lines are split or joined, their original ending belongs to the
    // last replacement line, nearest the next unchanged line.
    for (let count = 0; count < addedCount; count += 1) {
      const fromEnd = addedCount - count
      const oldPosition = fromEnd <= removedCount ? oldIndex + removedCount - fromEnd : undefined
      retainEnding(oldPosition, newIndex + count)
    }
    oldIndex += removedCount
    newIndex += addedCount
  }
  return newLines.map((line, index) => line.content + endings[index]).join('')
}

export function buildTextDiff(left: string, right: string, options: TextOptions): TextDiffRow[] {
  const leftLines = linesOf(left)
  const rightLines = linesOf(right)
  const normalize = (line: string) => {
    const spaced = options.ignoreWhitespace ? line.replace(/\s+/g, '') : line
    return options.ignoreCase ? spaced.toLocaleLowerCase() : spaced
  }
  const leftTokens = leftLines.map((line) => ({ ...line, normalized: normalize(line.content) }))
  const rightTokens = rightLines.map((line) => ({ ...line, normalized: normalize(line.content) }))
  const chunks = diffArrays(leftTokens, rightTokens, {
    comparator: (a, b) => a.normalized === b.normalized && (
      a.eol === b.eol || (options.ignoreWhitespace && a.eol !== '' && b.eol !== '')
    ),
  })
  const rows: TextDiffRow[] = []
  let leftIndex = 0
  let rightIndex = 0

  const push = (row: Omit<TextDiffRow, 'id'>) => rows.push({ ...row, id: rows.length })

  for (let index = 0; index < chunks.length;) {
    const chunk = chunks[index]
    if (!chunk.added && !chunk.removed) {
      for (let count = 0; count < chunk.value.length; count += 1) {
        push({
          leftNumber: leftIndex + 1,
          rightNumber: rightIndex + 1,
          left: leftLines[leftIndex].content,
          right: rightLines[rightIndex].content,
          leftEol: leftLines[leftIndex++].eol,
          rightEol: rightLines[rightIndex++].eol,
          status: 'same',
        })
      }
      index += 1
      continue
    }

    let removedCount = 0
    let addedCount = 0
    while (index < chunks.length && (chunks[index].added || chunks[index].removed)) {
      if (chunks[index].removed) removedCount += chunks[index].value.length
      if (chunks[index].added) addedCount += chunks[index].value.length
      index += 1
    }
    for (let count = 0; count < Math.max(removedCount, addedCount); count += 1) {
      const hasLeft = count < removedCount
      const hasRight = count < addedCount
      push({
        leftNumber: hasLeft ? leftIndex + count + 1 : undefined,
        rightNumber: hasRight ? rightIndex + count + 1 : undefined,
        left: hasLeft ? leftLines[leftIndex + count].content : undefined,
        right: hasRight ? rightLines[rightIndex + count].content : undefined,
        leftEol: hasLeft ? leftLines[leftIndex + count].eol : undefined,
        rightEol: hasRight ? rightLines[rightIndex + count].eol : undefined,
        status: hasLeft && hasRight ? 'modified' : hasLeft ? 'removed' : 'added',
      })
    }
    leftIndex += removedCount
    rightIndex += addedCount
  }
  return rows
}

export function textStats(rows: TextDiffRow[]) {
  return rows.reduce((stats, row) => {
    if (row.status === 'added') stats.added += 1
    if (row.status === 'removed') stats.removed += 1
    if (row.status === 'modified') stats.modified += 1
    return stats
  }, { added: 0, removed: 0, modified: 0 })
}

export function inlineParts(left: string, right: string, side: 'left' | 'right', precision: DiffPrecision = 'smart') {
  const wordParts = diffWordsWithSpace(left, right)
  const changedLength = wordParts.filter((part) => part.added || part.removed).reduce((sum, part) => sum + part.value.length, 0)
  const useChars = precision === 'char' || (precision === 'smart' && changedLength <= 24)
  return (useChars ? diffChars(left, right) : wordParts)
    .filter((part) => side === 'left' ? !part.added : !part.removed)
    .map((part) => ({ text: part.value, changed: side === 'left' ? !!part.removed : !!part.added }))
}

export function patchFor(left: string, right: string, leftName: string, rightName: string) {
  return createPatch(rightName, left, right, leftName, rightName)
}

export function mergeDiffBlock(rows: TextDiffRow[], selectedRow: number, direction: 'left-to-right' | 'right-to-left') {
  let start = selectedRow
  let end = selectedRow
  while (start > 0 && rows[start - 1]?.status !== 'same') start -= 1
  while (end < rows.length - 1 && rows[end + 1]?.status !== 'same') end += 1
  return rows.flatMap((row, index) => {
    const useLeft = index >= start && index <= end ? direction === 'left-to-right' : direction === 'right-to-left'
    const value = useLeft ? row.left : row.right
    const eol = useLeft ? row.leftEol : row.rightEol
    return value === undefined ? [] : [value + (eol ?? '')]
  }).join('')
}
