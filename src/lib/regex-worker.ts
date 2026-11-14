type Request = { pattern: string; flags: string; input: string }
type Match = { index: number; value: string; groups: string[] }

self.onmessage = (event: MessageEvent<Request>) => {
  try {
    const { pattern, flags, input } = event.data
    if (pattern.length > 500 || input.length > 100000) throw new Error('Pattern or text is too long')
    const effectiveFlags = flags.includes('g') ? flags : flags + 'g'
    const expression = new RegExp(pattern, effectiveFlags)
    const matches: Match[] = []
    for (const match of input.matchAll(expression)) {
      matches.push({ index: match.index, value: match[0], groups: match.slice(1) })
      if (matches.length >= 100) break
    }
    self.postMessage({ matches })
  } catch (cause) {
    self.postMessage({ error: cause instanceof Error ? cause.message : String(cause) })
  }
}
