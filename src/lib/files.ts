export function formatBytes(bytes?: number): string {
  if (bytes === undefined) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[index]}`
}

export function isTauriApp(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function saveTextFile(content: string, suggestedName: string): Promise<void> {
  if (isTauriApp()) {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('save_text_file', { suggestedName, content })
    return
  }
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = suggestedName
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function saveBinaryFile(bytes: Uint8Array, suggestedName: string, mimeType: string): Promise<void> {
  if (isTauriApp()) {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('save_binary_file', { suggestedName, bytes: Array.from(bytes) })
    return
  }
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mimeType }))
  const link = document.createElement('a')
  link.href = url
  link.download = suggestedName
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function fileExtension(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

export function isTextFileName(name: string): boolean {
  return /\.(txt|md|markdown|json|jsonl|xml|html?|css|scss|js|jsx|ts|tsx|py|rs|go|java|c|h|cpp|hpp|cs|php|rb|sh|zsh|bash|yml|yaml|toml|ini|conf|log|sql|svg|csv|tsv)$/i.test(name)
}
