export type Conflict = {
  start: number
  end: number
  local: string
  remote: string
  base: string
  number: number
}

type Line = { start: number; end: number; content: string }

function splitWithOffsets(text: string): Line[] {
  const lines: Line[] = []
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '\r' && text[index] !== '\n') continue
    const end = text[index] === '\r' && text[index + 1] === '\n' ? index + 2 : index + 1
    lines.push({ start, end, content: text.slice(start, index) })
    start = end
    index = end - 1
  }
  if (start < text.length) lines.push({ start, end: text.length, content: text.slice(start) })
  return lines
}

export function findMergeConflicts(text: string): Conflict[] {
  const lines = splitWithOffsets(text)
  const conflicts: Conflict[] = []
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].content.startsWith('<<<<<<<')) continue
    const start = index
    let baseSeparator = -1
    let separator = -1
    let end = -1
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (lines[cursor].content.startsWith('|||||||') && separator < 0) baseSeparator = cursor
      else if (lines[cursor].content === '=======') separator = cursor
      else if (lines[cursor].content.startsWith('>>>>>>>') && separator >= 0) { end = cursor; break }
    }
    if (separator < 0 || end < 0) continue
    const localEnd = baseSeparator >= 0 ? baseSeparator : separator
    const local = text.slice(lines[start].end, lines[localEnd].start)
    const base = baseSeparator >= 0 ? text.slice(lines[baseSeparator].end, lines[separator].start) : ''
    const remote = text.slice(lines[separator].end, lines[end].start)
    conflicts.push({ start: lines[start].start, end: lines[end].end, local, remote, base, number: conflicts.length + 1 })
    index = end
  }
  return conflicts
}
