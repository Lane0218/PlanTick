import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { CategoryRecord, EventRecord, TodoRecord, WorkspaceMeta } from './local-types'
import type { OutboxOperation, RemoteChangeSet, SyncMeta, SyncStoreAdapter } from './sync-types'

const databaseName = 'plantick-app'
const legacyStoreName = 'phase0_meta'

interface PlantickDBSchema extends DBSchema {
  phase0_meta: {
    key: string
    value: string
  }
  workspace_meta: {
    key: WorkspaceMeta['key']
    value: WorkspaceMeta
  }
  sync_meta: {
    key: string
    value: SyncMeta
  }
  categories: {
    key: string
    value: CategoryRecord
    indexes: {
      'by-workspace': string
      'by-updated-at': string
    }
  }
  todos: {
    key: string
    value: TodoRecord
    indexes: {
      'by-workspace': string
      'by-due-date': string
      'by-updated-at': string
    }
  }
  events: {
    key: string
    value: EventRecord
    indexes: {
      'by-workspace': string
      'by-date': string
      'by-updated-at': string
    }
  }
  outbox: {
    key: string
    value: OutboxOperation
    indexes: {
      'by-workspace': string
      'by-created-at': string
      'by-retry-count': number
    }
  }
}

let databasePromise: Promise<IDBPDatabase<PlantickDBSchema>> | null = null

function createRandomId(prefix: string) {
  if (typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${prefix}-${hex}`
}

function createDefaultCursor() {
  return {
    categories: { updatedAt: null },
    todos: { updatedAt: null },
    events: { updatedAt: null },
  }
}

export async function getDatabase() {
  if (!databasePromise) {
    databasePromise = openDB<PlantickDBSchema>(databaseName, 2, {
      upgrade(database, oldVersion) {
        if (oldVersion < 1 && !database.objectStoreNames.contains(legacyStoreName)) {
          database.createObjectStore(legacyStoreName)
        }

        if (oldVersion < 2) {
          if (!database.objectStoreNames.contains('workspace_meta')) {
            database.createObjectStore('workspace_meta')
          }

          if (!database.objectStoreNames.contains('sync_meta')) {
            database.createObjectStore('sync_meta', {
              keyPath: 'workspaceId',
            })
          }

          if (!database.objectStoreNames.contains('categories')) {
            const store = database.createObjectStore('categories', {
              keyPath: 'id',
            })
            store.createIndex('by-workspace', 'workspaceId')
            store.createIndex('by-updated-at', 'updatedAt')
          }

          if (!database.objectStoreNames.contains('todos')) {
            const store = database.createObjectStore('todos', {
              keyPath: 'id',
            })
            store.createIndex('by-workspace', 'workspaceId')
            store.createIndex('by-due-date', 'dueDate')
            store.createIndex('by-updated-at', 'updatedAt')
          }

          if (!database.objectStoreNames.contains('events')) {
            const store = database.createObjectStore('events', {
              keyPath: 'id',
            })
            store.createIndex('by-workspace', 'workspaceId')
            store.createIndex('by-date', 'date')
            store.createIndex('by-updated-at', 'updatedAt')
          }

          if (!database.objectStoreNames.contains('outbox')) {
            const store = database.createObjectStore('outbox', {
              keyPath: 'id',
            })
            store.createIndex('by-workspace', 'workspaceId')
            store.createIndex('by-created-at', 'createdAt')
            store.createIndex('by-retry-count', 'retryCount')
          }
        }
      },
    })
  }

  return databasePromise
}

export async function runIndexedDbProbe() {
  const database = await getDatabase()
  const probeId = createRandomId('probe')
  const current = await database.get('workspace_meta', 'current')

  if (current) {
    await database.put('workspace_meta', {
      ...current,
      lastProbeId: probeId,
      lastSeenAt: new Date().toISOString(),
    })
  } else if (database.objectStoreNames.contains(legacyStoreName)) {
    await database.put(legacyStoreName, probeId, 'lastProbeId')
  }

  return probeId
}

export async function saveCurrentWorkspaceMeta(
  workspaceId: string,
  anonymousUserId: string | null = null,
) {
  const database = await getDatabase()
  const now = new Date().toISOString()
  const current = await database.get('workspace_meta', 'current')

  const next: WorkspaceMeta = {
    key: 'current',
    workspaceId,
    anonymousUserId,
    joinedAt: current?.joinedAt ?? now,
    lastSeenAt: now,
    lastProbeId: current?.lastProbeId ?? null,
  }

  await database.put('workspace_meta', next, 'current')

  if (database.objectStoreNames.contains(legacyStoreName)) {
    await database.put(legacyStoreName, workspaceId, 'workspaceId')
  }
}

export async function getCurrentWorkspaceMeta() {
  const database = await getDatabase()
  const current = await database.get('workspace_meta', 'current')
  if (current) {
    return current
  }

  const workspaceId = database.objectStoreNames.contains(legacyStoreName)
    ? await database.get(legacyStoreName, 'workspaceId')
    : null

  if (typeof workspaceId === 'string' && workspaceId) {
    return {
      key: 'current' as const,
      workspaceId,
      anonymousUserId: null,
      joinedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      lastProbeId: null,
    }
  }

  return null
}

export async function saveWorkspaceId(workspaceId: string) {
  await saveCurrentWorkspaceMeta(workspaceId)
}

export async function loadWorkspaceId() {
  const current = await getCurrentWorkspaceMeta()
  return current?.workspaceId ?? ''
}

export async function readSyncMeta(workspaceId: string) {
  const database = await getDatabase()
  return (await database.get('sync_meta', workspaceId)) ?? null
}

export async function writeSyncMeta(meta: SyncMeta) {
  const database = await getDatabase()
  await database.put('sync_meta', meta)
}

export async function ensureSyncMeta(workspaceId: string) {
  const existing = await readSyncMeta(workspaceId)
  if (existing) {
    return existing
  }

  const initial: SyncMeta = {
    workspaceId,
    status: 'idle',
    lastPushAt: null,
    lastPullAt: null,
    lastError: null,
    cursor: createDefaultCursor(),
  }

  await writeSyncMeta(initial)
  return initial
}

export async function upsertCategory(record: CategoryRecord) {
  const database = await getDatabase()
  await database.put('categories', record)
}

export async function listCategories(workspaceId: string) {
  const database = await getDatabase()
  return database.getAllFromIndex('categories', 'by-workspace', workspaceId)
}

export async function upsertTodo(record: TodoRecord) {
  const database = await getDatabase()
  await database.put('todos', record)
}

export async function listTodos(workspaceId: string) {
  const database = await getDatabase()
  return database.getAllFromIndex('todos', 'by-workspace', workspaceId)
}

export async function upsertEvent(record: EventRecord) {
  const database = await getDatabase()
  await database.put('events', record)
}

export async function listEvents(workspaceId: string) {
  const database = await getDatabase()
  return database.getAllFromIndex('events', 'by-workspace', workspaceId)
}

export async function writeOutbox(operation: OutboxOperation) {
  const database = await getDatabase()
  await database.put('outbox', operation)
}

export async function listPendingOutbox(workspaceId: string, limit = 100) {
  const database = await getDatabase()
  const operations = await database.getAllFromIndex('outbox', 'by-workspace', workspaceId)
  return operations
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(0, limit)
}

export async function removeOutbox(operationIds: string[]) {
  const database = await getDatabase()
  const transaction = database.transaction('outbox', 'readwrite')
  await Promise.all(operationIds.map((operationId) => transaction.store.delete(operationId)))
  await transaction.done
}

export async function bumpOutboxRetry(operationId: string, lastError: string) {
  const database = await getDatabase()
  const current = await database.get('outbox', operationId)
  if (!current) {
    return
  }

  await database.put('outbox', {
    ...current,
    retryCount: current.retryCount + 1,
    lastError,
  })
}

export async function applyRemoteChanges(changes: RemoteChangeSet) {
  const database = await getDatabase()
  const transaction = database.transaction(['categories', 'todos', 'events'], 'readwrite')

  await Promise.all([
    ...changes.categories.map((record) =>
      transaction.objectStore('categories').put({
        id: record.id,
        workspaceId: record.workspace_id,
        name: String(record.name ?? ''),
        color: String(record.color ?? '#7c8f77'),
        updatedAt: record.updated_at,
        deleted: record.deleted,
      }),
    ),
    ...changes.todos.map((record) =>
      transaction.objectStore('todos').put({
        id: record.id,
        workspaceId: record.workspace_id,
        title: String(record.title ?? ''),
        categoryId:
          typeof record.category_id === 'string' ? record.category_id : null,
        dueDate: typeof record.due_date === 'string' ? record.due_date : null,
        completed: Boolean(record.completed),
        note: String(record.note ?? ''),
        recurrenceType:
          record.recurrence_type === 'daily' ||
          record.recurrence_type === 'weekly' ||
          record.recurrence_type === 'monthly'
            ? record.recurrence_type
            : 'none',
        updatedAt: record.updated_at,
        deleted: record.deleted,
      }),
    ),
    ...changes.events.map((record) =>
      transaction.objectStore('events').put({
        id: record.id,
        workspaceId: record.workspace_id,
        title: String(record.title ?? ''),
        date: String(record.date ?? ''),
        startAt: typeof record.start_at === 'string' ? record.start_at : null,
        endAt: typeof record.end_at === 'string' ? record.end_at : null,
        note: String(record.note ?? ''),
        updatedAt: record.updated_at,
        deleted: record.deleted,
      }),
    ),
  ])

  await transaction.done

  return changes.categories.length + changes.todos.length + changes.events.length
}

export const syncStoreAdapter: SyncStoreAdapter = {
  readSyncMeta,
  writeSyncMeta,
  listPendingOutbox,
  removeOutbox,
  bumpOutboxRetry,
  applyRemoteChanges,
}
