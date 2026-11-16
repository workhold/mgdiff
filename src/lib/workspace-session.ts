import type { WorkspaceValues } from './workspace-state'

export type SessionMode = 'text' | 'table' | 'image' | 'folder' | 'pdf' | 'toolbox'
export type SessionTab = { id: number; mode: SessionMode; fileName?: string; state: WorkspaceValues }
export type WorkspaceSession = {
  tabs: SessionTab[]
  activeTabId: number | null
  nextId: number
  lastMode: SessionMode
  sidebarOpen: boolean
}

type FileReference = { __mgdiffFile: string; name: string; size: number; type: string; lastModified: number }
type StoredFile = { key: string; blob: Blob; name: string; type: string; lastModified: number }
type StoredSession = { version: 1; revision: number; session: WorkspaceSession }

const STORAGE_KEY = 'mgdiff.workspace.v1'
const DATABASE_NAME = 'mgdiff-workspace-v1'
const FILE_STORE = 'files'
const SESSION_STORE = 'session'
const SESSION_KEY = 'current'
const MODES: SessionMode[] = ['text', 'table', 'image', 'folder', 'pdf', 'toolbox']

let revision = 0
let desiredFiles = new Map<string, File>()
let pendingSnapshot: { stored: StoredSession; localSaved: boolean; hasFiles: boolean } | null = null
let pendingFiles = new Map<string, File | null>()
let writing: Promise<boolean> | null = null
let pendingLoad: Promise<{ session: WorkspaceSession | null; missingFiles: boolean }> | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isFileReference(value: unknown): value is FileReference {
  return isRecord(value) && typeof value.__mgdiffFile === 'string' && typeof value.name === 'string' &&
    typeof value.size === 'number' && typeof value.type === 'string' && typeof value.lastModified === 'number'
}

function validateSession(value: unknown): WorkspaceSession | null {
  if (!isRecord(value) || !Array.isArray(value.tabs)) return null
  const tabs: SessionTab[] = []
  const seen = new Set<number>()
  for (const item of value.tabs) {
    if (!isRecord(item) || !Number.isSafeInteger(item.id) || (item.id as number) < 1 || seen.has(item.id as number) || !MODES.includes(item.mode as SessionMode)) continue
    const id = item.id as number
    seen.add(id)
    tabs.push({ id, mode: item.mode as SessionMode, fileName: typeof item.fileName === 'string' ? item.fileName : undefined, state: isRecord(item.state) ? item.state : {} })
  }
  const activeTabId = typeof value.activeTabId === 'number' && seen.has(value.activeTabId) ? value.activeTabId : null
  const nextId = Math.max(1, ...tabs.map((tab) => tab.id), Number.isSafeInteger(value.nextId) ? value.nextId as number : 1)
  return {
    tabs,
    activeTabId,
    nextId,
    lastMode: MODES.includes(value.lastMode as SessionMode) ? value.lastMode as SessionMode : tabs.find((tab) => tab.id === activeTabId)?.mode ?? 'text',
    sidebarOpen: typeof value.sidebarOpen === 'boolean' ? value.sidebarOpen : true,
  }
}

function parseStored(value: unknown): StoredSession | null {
  if (!isRecord(value) || value.version !== 1 || !Number.isSafeInteger(value.revision)) return null
  const session = validateSession(value.session)
  return session ? { version: 1, revision: value.revision as number, session } : null
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return }
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(FILE_STORE)) database.createObjectStore(FILE_STORE, { keyPath: 'key' })
      if (!database.objectStoreNames.contains(SESSION_STORE)) database.createObjectStore(SESSION_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Unable to open workspace database'))
    request.onblocked = () => reject(new Error('Workspace database is blocked'))
  })
}

async function readDatabase(): Promise<{ stored: StoredSession | null; files: Map<string, File> }> {
  const database = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction([SESSION_STORE, FILE_STORE], 'readonly')
      const sessionRequest = transaction.objectStore(SESSION_STORE).get(SESSION_KEY)
      const filesRequest = transaction.objectStore(FILE_STORE).getAll()
      transaction.oncomplete = () => {
        const files = new Map<string, File>()
        for (const item of filesRequest.result as StoredFile[]) {
          files.set(item.key, new File([item.blob], item.name, { type: item.type, lastModified: item.lastModified }))
        }
        resolve({ stored: parseStored(sessionRequest.result), files })
      }
      transaction.onerror = () => reject(transaction.error ?? new Error('Unable to read workspace database'))
      transaction.onabort = () => reject(transaction.error ?? new Error('Workspace database read aborted'))
    })
  } finally {
    database.close()
  }
}

async function writeDatabase(stored: StoredSession, additions: Map<string, File>, removals: string[]): Promise<void> {
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction([SESSION_STORE, FILE_STORE], 'readwrite')
      transaction.objectStore(SESSION_STORE).put(stored, SESSION_KEY)
      const files = transaction.objectStore(FILE_STORE)
      for (const [key, file] of additions) files.put({ key, blob: file, name: file.name, type: file.type, lastModified: file.lastModified } satisfies StoredFile)
      for (const key of removals) files.delete(key)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('Unable to save workspace'))
      transaction.onabort = () => reject(transaction.error ?? new Error('Workspace save aborted'))
    })
  } finally {
    database.close()
  }
}

async function drainWrites(): Promise<boolean> {
  let saved = true
  while (pendingSnapshot) {
    const { stored, localSaved, hasFiles } = pendingSnapshot
    const changed = pendingFiles
    pendingSnapshot = null
    pendingFiles = new Map()
    const additions = new Map<string, File>()
    const removals: string[] = []
    for (const [key, file] of changed) {
      if (file) additions.set(key, file)
      else removals.push(key)
    }
    try {
      await writeDatabase(stored, additions, removals)
    } catch {
      for (const [key, file] of additions) if (desiredFiles.get(key) === file) desiredFiles.delete(key)
      if (!localSaved || hasFiles) {
        saved = false
        window.dispatchEvent(new Event('mgdiff:workspace-save-error'))
      }
    }
  }
  return saved
}

function startWriting(): void {
  if (writing) return
  writing = Promise.resolve().then(drainWrites).then(
    (saved) => {
      writing = null
      if (pendingSnapshot) startWriting()
      return saved
    },
    () => {
      writing = null
      window.dispatchEvent(new Event('mgdiff:workspace-save-error'))
      if (pendingSnapshot) startWriting()
      return false
    },
  )
}

/** Wait for every queued file and session write before a native window closes. */
export async function flushWorkspaceSession(): Promise<boolean> {
  let saved = true
  while (writing) saved = (await writing) && saved
  return saved
}

function encode(value: unknown, path: (string | number)[], files: Map<string, File>): unknown {
  if (value instanceof File) {
    const key = JSON.stringify(path)
    files.set(key, value)
    return { __mgdiffFile: key, name: value.name, size: value.size, type: value.type, lastModified: value.lastModified } satisfies FileReference
  }
  if (value instanceof Set) return { __mgdiffSet: Array.from(value, (item, index) => encode(item, [...path, index], files)) }
  if (Array.isArray(value)) return value.map((item, index) => encode(item, [...path, index], files))
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item, [...path, key], files)]))
  return value
}

function decode(value: unknown, files: Map<string, File>, missing: { value: boolean }): unknown {
  if (isFileReference(value)) {
    const file = files.get(value.__mgdiffFile)
    if (file && file.name === value.name && file.size === value.size && file.type === value.type && file.lastModified === value.lastModified) return file
    missing.value = true
    return null
  }
  if (isRecord(value) && Array.isArray(value.__mgdiffSet)) return new Set(value.__mgdiffSet.map((item) => decode(item, files, missing)))
  if (Array.isArray(value)) return value.map((item) => decode(item, files, missing))
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item, files, missing)]))
  return value
}

function readLocal(): StoredSession | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? parseStored(JSON.parse(raw) as unknown) : null
  } catch { return null }
}

async function readWorkspaceSession(): Promise<{ session: WorkspaceSession | null; missingFiles: boolean }> {
  const local = readLocal()
  let database: Awaited<ReturnType<typeof readDatabase>> | null = null
  try { database = await readDatabase() } catch { /* Text and tab metadata can still be restored from localStorage. */ }
  const stored = local && (!database?.stored || local.revision >= database.stored.revision) ? local : database?.stored ?? null
  revision = stored?.revision ?? 0
  const files = database?.files ?? new Map<string, File>()
  const missing = { value: false }
  const session = stored ? decode(stored.session, files, missing) as WorkspaceSession : null
  // Include orphaned records so the first save can remove files from tabs that closed
  // just before the previous process exited.
  desiredFiles = files
  return { session, missingFiles: missing.value }
}

export function loadWorkspaceSession(): Promise<{ session: WorkspaceSession | null; missingFiles: boolean }> {
  if (!pendingLoad) pendingLoad = readWorkspaceSession().finally(() => { pendingLoad = null })
  return pendingLoad
}

/** Writes text and tab metadata synchronously; binary files and a backup follow in IndexedDB. */
export function saveWorkspaceSession(session: WorkspaceSession): void {
  const files = new Map<string, File>()
  const encoded: WorkspaceSession = { ...session, tabs: session.tabs.map((tab) => ({ ...tab, state: encode(tab.state, [tab.id], files) as WorkspaceValues })) }
  const stored: StoredSession = { version: 1, revision: ++revision, session: encoded }
  let localSaved = true
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored)) } catch { localSaved = false }
  const additions = new Map<string, File>()
  for (const [key, file] of files) if (desiredFiles.get(key) !== file) additions.set(key, file)
  const removals = [...desiredFiles.keys()].filter((key) => !files.has(key))
  desiredFiles = files
  pendingSnapshot = { stored, localSaved, hasFiles: files.size > 0 }
  for (const [key, file] of additions) pendingFiles.set(key, file)
  for (const key of removals) pendingFiles.set(key, null)
  startWriting()
}
