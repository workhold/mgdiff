export type HistoryMode = 'text' | 'table' | 'image' | 'folder' | 'pdf'

type HistoryBaseInput = {
  leftName: string
  rightName: string
  summary: string
  leftUntitled?: boolean
  rightUntitled?: boolean
}

export type HistoryRecordInput = HistoryBaseInput & (
  | { mode: 'text'; payload: { kind: 'text'; leftText: string; rightText: string } }
  | { mode: 'table' | 'image' | 'pdf'; payload: { kind: 'files'; leftFile: File; rightFile: File } }
  | { mode: 'folder'; payload: { kind: 'folder' } }
)

export type HistoryEntry = {
  id: string
  createdAt: number
  mode: HistoryMode
  leftName: string
  rightName: string
  summary: string
  leftUntitled?: boolean
  rightUntitled?: boolean
  replayable: boolean
  unavailableReason?: string
}

export type HistoryReplayPayload =
  | { mode: 'text'; leftName: string; rightName: string; leftText: string; rightText: string; leftUntitled?: boolean; rightUntitled?: boolean }
  | { mode: 'table' | 'image' | 'pdf'; leftFile: File; rightFile: File }

type StoredFile = { blob: Blob; name: string; type: string; lastModified: number }
type HistorySnapshot =
  | { id: string; kind: 'text'; leftText: string; rightText: string }
  | { id: string; kind: 'files'; left: StoredFile; right: StoredFile }

const DB_NAME = 'mgdiff-history-v1'
const DB_VERSION = 1
const ENTRY_STORE = 'entries'
const SNAPSHOT_STORE = 'snapshots'
const FALLBACK_ENTRIES_KEY = 'mgdiff.history.entries.v1'
const FALLBACK_SNAPSHOT_PREFIX = 'mgdiff.history.snapshot.'
const MAX_TEXT_BYTES = 2 * 1024 * 1024
const MAX_FILE_BYTES = 16 * 1024 * 1024
const MAX_FILE_PAIR_BYTES = 24 * 1024 * 1024
const MAX_FALLBACK_TEXT_BYTES = 512 * 1024

/** Fired on this page after a record is saved or deleted. */
export const HISTORY_CHANGED_EVENT = 'mgdiff:history-changed'

function announceChange() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(HISTORY_CHANGED_EVENT))
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB 不可用')); return }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(ENTRY_STORE)) db.createObjectStore(ENTRY_STORE, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) db.createObjectStore(SNAPSHOT_STORE, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('无法打开本地历史数据库'))
    request.onblocked = () => reject(new Error('本地历史数据库被占用'))
  })
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('本地历史读取失败'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('本地历史保存失败'))
    transaction.onerror = () => reject(transaction.error ?? new Error('本地历史保存失败'))
  })
}

async function readEntriesFromDatabase(): Promise<HistoryEntry[]> {
  const db = await openDatabase()
  try {
    const transaction = db.transaction(ENTRY_STORE, 'readonly')
    const done = transactionDone(transaction)
    const [entries] = await Promise.all([
      requestResult(transaction.objectStore(ENTRY_STORE).getAll() as IDBRequest<HistoryEntry[]>), done,
    ])
    return entries
  } finally {
    db.close()
  }
}

async function readSnapshotFromDatabase(id: string): Promise<HistorySnapshot | undefined> {
  const db = await openDatabase()
  try {
    const transaction = db.transaction(SNAPSHOT_STORE, 'readonly')
    const done = transactionDone(transaction)
    const [snapshot] = await Promise.all([
      requestResult(transaction.objectStore(SNAPSHOT_STORE).get(id) as IDBRequest<HistorySnapshot | undefined>), done,
    ])
    return snapshot
  } finally {
    db.close()
  }
}

async function writeToDatabase(entry: HistoryEntry, snapshot?: HistorySnapshot): Promise<void> {
  const db = await openDatabase()
  try {
    const transaction = db.transaction([ENTRY_STORE, SNAPSHOT_STORE], 'readwrite')
    const done = transactionDone(transaction)
    transaction.objectStore(ENTRY_STORE).put(entry)
    if (snapshot) transaction.objectStore(SNAPSHOT_STORE).put(snapshot)
    await done
  } finally {
    db.close()
  }
}

async function deleteFromDatabase(id?: string): Promise<void> {
  const db = await openDatabase()
  try {
    const transaction = db.transaction([ENTRY_STORE, SNAPSHOT_STORE], 'readwrite')
    const done = transactionDone(transaction)
    for (const storeName of [ENTRY_STORE, SNAPSHOT_STORE]) {
      const store = transaction.objectStore(storeName)
      if (id === undefined) store.clear()
      else store.delete(id)
    }
    await done
  } finally {
    db.close()
  }
}

function fallbackEntries(): HistoryEntry[] {
  try {
    const value = localStorage.getItem(FALLBACK_ENTRIES_KEY)
    if (!value) return []
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter(isHistoryEntry) : []
  } catch {
    return []
  }
}

function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<HistoryEntry>
  return typeof entry.id === 'string' && typeof entry.createdAt === 'number' && Number.isFinite(entry.createdAt) &&
    ['text', 'table', 'image', 'folder', 'pdf'].includes(entry.mode ?? '') && typeof entry.leftName === 'string' &&
    typeof entry.rightName === 'string' && typeof entry.summary === 'string' &&
    typeof entry.replayable === 'boolean'
}

function writeFallback(entry: HistoryEntry, snapshot?: HistorySnapshot): HistoryEntry | null {
  try {
    const entries = fallbackEntries().filter((item) => item.id !== entry.id)
    let savedEntry = entry
    if (snapshot?.kind === 'text') {
      const serialized = JSON.stringify(snapshot)
      if (new Blob([serialized]).size <= MAX_FALLBACK_TEXT_BYTES) {
        try {
          localStorage.setItem(FALLBACK_SNAPSHOT_PREFIX + entry.id, serialized)
        } catch {
          savedEntry = { ...entry, replayable: false, unavailableReason: '本机存储空间不足，未保存文本快照' }
        }
      } else {
        savedEntry = { ...entry, replayable: false, unavailableReason: '文本快照超过本地备用存储上限' }
      }
    } else if (snapshot?.kind === 'files') {
      savedEntry = { ...entry, replayable: false, unavailableReason: '本机文件存储不可用，未保存原文件' }
    }
    try {
      localStorage.setItem(FALLBACK_ENTRIES_KEY, JSON.stringify([savedEntry, ...entries]))
      return savedEntry
    } catch {
      localStorage.removeItem(FALLBACK_SNAPSHOT_PREFIX + entry.id)
      return null
    }
  } catch {
    return null
  }
}

function toStoredFile(file: File): StoredFile {
  return { blob: file, name: file.name, type: file.type, lastModified: file.lastModified }
}

function createEntry(input: HistoryRecordInput): { entry: HistoryEntry; snapshot?: HistorySnapshot } {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const entry: HistoryEntry = {
    id,
    createdAt: Date.now(),
    mode: input.mode,
    leftName: input.leftName,
    rightName: input.rightName,
    summary: input.summary,
    leftUntitled: input.leftUntitled,
    rightUntitled: input.rightUntitled,
    replayable: false,
  }
  if (input.payload.kind === 'folder') {
    entry.unavailableReason = '目录内容未保存，请重新选择两个文件夹'
    return { entry }
  }
  if (input.payload.kind === 'text') {
    const bytes = new Blob([input.payload.leftText, input.payload.rightText]).size
    if (bytes > MAX_TEXT_BYTES) {
      entry.unavailableReason = '文本超过 2 MB，未保存原文'
      return { entry }
    }
    entry.replayable = true
    return { entry, snapshot: { id, kind: 'text', leftText: input.payload.leftText, rightText: input.payload.rightText } }
  }
  const { leftFile, rightFile } = input.payload
  if (leftFile.size > MAX_FILE_BYTES || rightFile.size > MAX_FILE_BYTES || leftFile.size + rightFile.size > MAX_FILE_PAIR_BYTES) {
    entry.unavailableReason = '文件超过快照大小上限，请重新选择原文件'
    return { entry }
  }
  entry.replayable = true
  return { entry, snapshot: { id, kind: 'files', left: toStoredFile(leftFile), right: toStoredFile(rightFile) } }
}

/** Stores a local comparison. Returns null only if both IndexedDB and localStorage fail. */
export async function recordHistory(input: HistoryRecordInput): Promise<HistoryEntry | null> {
  const { entry, snapshot } = createEntry(input)
  try {
    await writeToDatabase(entry, snapshot)
    announceChange()
    return entry
  } catch {
    if (snapshot?.kind === 'text') {
      const fallback = writeFallback(entry, snapshot)
      if (fallback) { announceChange(); return fallback }
    }
    // Quota failures may still allow a metadata-only IndexedDB entry.
    if (snapshot) {
      const summaryOnly: HistoryEntry = { ...entry, replayable: false, unavailableReason: '本机存储空间不足，只保存了差异摘要' }
      try {
        await writeToDatabase(summaryOnly)
        announceChange()
        return summaryOnly
      } catch {
        const fallback = writeFallback(entry, snapshot)
        if (fallback) announceChange()
        return fallback
      }
    }
    const fallback = writeFallback(entry)
    if (fallback) announceChange()
    return fallback
  }
}

/** Newest first. Includes entries saved through the localStorage fallback. */
export async function listHistory(): Promise<HistoryEntry[]> {
  let databaseEntries: HistoryEntry[] = []
  try { databaseEntries = await readEntriesFromDatabase() } catch { /* IndexedDB may be disabled. */ }
  const byId = new Map<string, HistoryEntry>()
  for (const entry of [...fallbackEntries(), ...databaseEntries]) byId.set(entry.id, entry)
  return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt)
}

/** Returns a self-contained pair that can be passed back to the matching mode. */
export async function getReplayPayload(id: string): Promise<HistoryReplayPayload | null> {
  const entry = (await listHistory()).find((item) => item.id === id)
  if (!entry?.replayable) return null
  let snapshot: HistorySnapshot | undefined
  try { snapshot = await readSnapshotFromDatabase(id) } catch { /* Try the fallback. */ }
  if (!snapshot) {
    try {
      const raw = localStorage.getItem(FALLBACK_SNAPSHOT_PREFIX + id)
      if (raw) snapshot = JSON.parse(raw) as HistorySnapshot
    } catch { return null }
  }
  if (snapshot?.kind === 'text' && entry.mode === 'text') {
    return { mode: 'text', leftName: entry.leftName, rightName: entry.rightName, leftText: snapshot.leftText, rightText: snapshot.rightText,
      leftUntitled: entry.leftUntitled ?? entry.leftName === '未命名', rightUntitled: entry.rightUntitled ?? entry.rightName === '未命名' }
  }
  if (snapshot?.kind === 'files' && (entry.mode === 'table' || entry.mode === 'image' || entry.mode === 'pdf')) {
    const restore = (stored: StoredFile) => new File([stored.blob], stored.name, { type: stored.type, lastModified: stored.lastModified })
    return { mode: entry.mode, leftFile: restore(snapshot.left), rightFile: restore(snapshot.right) }
  }
  return null
}

export async function removeHistory(id: string): Promise<void> {
  try { await deleteFromDatabase(id) } catch { /* The fallback may still contain the record. */ }
  try {
    localStorage.removeItem(FALLBACK_SNAPSHOT_PREFIX + id)
    localStorage.setItem(FALLBACK_ENTRIES_KEY, JSON.stringify(fallbackEntries().filter((entry) => entry.id !== id)))
  } catch { /* Storage may be disabled. */ }
  if ((await listHistory()).some((entry) => entry.id === id)) throw new Error('删除历史记录失败')
  announceChange()
}

export async function clearHistory(): Promise<void> {
  try { await deleteFromDatabase() } catch { /* The fallback may still contain records. */ }
  try {
    for (const entry of fallbackEntries()) localStorage.removeItem(FALLBACK_SNAPSHOT_PREFIX + entry.id)
    localStorage.removeItem(FALLBACK_ENTRIES_KEY)
  } catch { /* Storage may be disabled. */ }
  if ((await listHistory()).length) throw new Error('清空历史记录失败')
  announceChange()
}
