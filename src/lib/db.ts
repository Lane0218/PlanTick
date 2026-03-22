import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { CategoryRecord, EventRecord, TodoRecord, WorkspaceMeta } from './local-types'
import type { OutboxOperation, RemoteChangeSet, SyncMeta, SyncRecord, SyncStoreAdapter } from './sync-types'

const databaseName = 'plantick-app'

interface PlantickDBSchema extends DBSchema {
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
      'by-my-day-date': string
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

function readCategorySortOrder(record: Record<string, unknown>) {
  const candidate =
    typeof record.sortOrder === 'number' && Number.isFinite(record.sortOrder)
      ? record.sortOrder
      : typeof record.sort_order === 'number' && Number.isFinite(record.sort_order)
        ? record.sort_order
        : null

  return candidate
}

function compareCategoryFallback(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
) {
  const leftName = String(left.name ?? '')
  const rightName = String(right.name ?? '')
  const nameCompare = leftName.localeCompare(rightName, 'zh-CN')
  if (nameCompare !== 0) {
    return nameCompare
  }

  const leftUpdatedAt = String(left.updatedAt ?? left.updated_at ?? '')
  const rightUpdatedAt = String(right.updatedAt ?? right.updated_at ?? '')
  const updatedAtCompare = leftUpdatedAt.localeCompare(rightUpdatedAt)
  if (updatedAtCompare !== 0) {
    return updatedAtCompare
  }

  return String(left.id ?? '').localeCompare(String(right.id ?? ''))
}

function normalizeCategoryRecord(
  record: Record<string, unknown>,
  fallbackSortOrder: number,
): CategoryRecord {
  return {
    id: String(record.id ?? ''),
    workspaceId: String(record.workspaceId ?? record.workspace_id ?? ''),
    name: String(record.name ?? ''),
    color: String(record.color ?? '#7c8f77'),
    sortOrder: readCategorySortOrder(record) ?? fallbackSortOrder,
    updatedAt: String(record.updatedAt ?? record.updated_at ?? new Date().toISOString()),
    deleted: Boolean(record.deleted),
  }
}

function normalizeCategoryRecords(records: Array<Record<string, unknown>>) {
  return [...records]
    .sort((left, right) => {
      const leftSortOrder = readCategorySortOrder(left)
      const rightSortOrder = readCategorySortOrder(right)

      if (leftSortOrder !== null && rightSortOrder !== null) {
        return leftSortOrder - rightSortOrder || compareCategoryFallback(left, right)
      }

      if (leftSortOrder !== null) {
        return -1
      }

      if (rightSortOrder !== null) {
        return 1
      }

      return compareCategoryFallback(left, right)
    })
    .map((record, index) => normalizeCategoryRecord(record, index))
}

function normalizeTodoStatus(
  record: Record<string, unknown> & { status?: unknown },
): TodoRecord['status'] {
  return record.status === 'not_started' ||
    record.status === 'in_progress' ||
    record.status === 'completed' ||
    record.status === 'blocked'
    ? record.status
    : 'not_started'
}

function normalizeEventStatus(
  record: Record<string, unknown> & { status?: unknown },
): EventRecord['status'] {
  return record.status === 'completed' ? 'completed' : 'not_completed'
}

function normalizeEventAllDay(
  record: Record<string, unknown> & { allDay?: unknown; startAt?: unknown; endAt?: unknown; all_day?: unknown; start_at?: unknown; end_at?: unknown },
) {
  if (typeof record.allDay === 'boolean') {
    return record.allDay
  }

  if (typeof record.all_day === 'boolean') {
    return record.all_day
  }

  const start = typeof record.startAt === 'string' ? record.startAt : typeof record.start_at === 'string' ? record.start_at : null
  const end = typeof record.endAt === 'string' ? record.endAt : typeof record.end_at === 'string' ? record.end_at : null
  return !start && !end
}

function normalizeEventSyncRecord(
  record: SyncRecord,
) {
  return {
    ...record,
    status: normalizeEventStatus(record),
    all_day: normalizeEventAllDay(record),
    start_at: typeof record.start_at === 'string' ? record.start_at : null,
    end_at: typeof record.end_at === 'string' ? record.end_at : null,
  } satisfies SyncRecord
}

function normalizeOutboxOperation(operation: OutboxOperation) {
  if (operation.entity !== 'events') {
    return operation
  }

  return {
    ...operation,
    payload: normalizeEventSyncRecord(operation.payload),
  } satisfies OutboxOperation
}

export async function getDatabase() {
  if (!databasePromise) {
    databasePromise = openDB<PlantickDBSchema>(databaseName, 4, {
      upgrade(database, oldVersion, _newVersion, transaction) {
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
            store.createIndex('by-my-day-date', 'myDayDate')
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

        if (oldVersion < 3 && database.objectStoreNames.contains('todos')) {
          const store = transaction.objectStore('todos')
          if (!store.indexNames.contains('by-my-day-date')) {
            store.createIndex('by-my-day-date', 'myDayDate')
          }
        }

        const legacyDatabase = database as unknown as {
          objectStoreNames: DOMStringList
          deleteObjectStore(name: string): void
        }
        if (oldVersion < 4 && legacyDatabase.objectStoreNames.contains('phase0_meta')) {
          legacyDatabase.deleteObjectStore('phase0_meta')
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
}

export async function getCurrentWorkspaceMeta() {
  const database = await getDatabase()
  return (await database.get('workspace_meta', 'current')) ?? null
}

export async function saveWorkspaceId(workspaceId: string) {
  await saveCurrentWorkspaceMeta(workspaceId)
}

export async function clearCurrentWorkspaceMeta() {
  const database = await getDatabase()
  const transaction = database.transaction('workspace_meta', 'readwrite')

  await transaction.objectStore('workspace_meta').delete('current')

  await transaction.done
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
  const records = (await database.getAllFromIndex('categories', 'by-workspace', workspaceId)) as Array<Record<string, unknown>>
  const normalized = normalizeCategoryRecords(records)

  if (
    normalized.some((record) => {
      const current = records.find((item) => String(item.id ?? '') === record.id)
      return !current || readCategorySortOrder(current) !== record.sortOrder
    })
  ) {
    await Promise.all(normalized.map((record) => database.put('categories', record)))
  }

  return normalized
}

export async function upsertTodo(record: TodoRecord) {
  const database = await getDatabase()
  await database.put('todos', record)
}

export async function listTodos(workspaceId: string) {
  const database = await getDatabase()
  const records = await database.getAllFromIndex('todos', 'by-workspace', workspaceId)
  return records.map((record) => {
    return {
      ...record,
      myDayDate: typeof record.myDayDate === 'string' ? record.myDayDate : null,
      completedOn: typeof record.completedOn === 'string' ? record.completedOn : null,
      status: normalizeTodoStatus(record),
    }
  })
}

export async function upsertEvent(record: EventRecord) {
  const database = await getDatabase()
  await database.put('events', record)
}

export async function listEvents(workspaceId: string) {
  const database = await getDatabase()
  const records = await database.getAllFromIndex('events', 'by-workspace', workspaceId)
  return records.map((record) => ({
    ...record,
    status: normalizeEventStatus(record),
    allDay: normalizeEventAllDay(record),
    startAt: typeof record.startAt === 'string' ? record.startAt : null,
    endAt: typeof record.endAt === 'string' ? record.endAt : null,
  }))
}

export async function writeOutbox(operation: OutboxOperation) {
  const database = await getDatabase()
  await database.put('outbox', normalizeOutboxOperation(operation))
}

export async function listPendingOutbox(workspaceId: string, limit = 100) {
  const database = await getDatabase()
  const operations = await database.getAllFromIndex('outbox', 'by-workspace', workspaceId)
  const normalizedOperations = operations.map(normalizeOutboxOperation)
  const patchedOperations = normalizedOperations.filter(
    (operation, index) => JSON.stringify(operation.payload) !== JSON.stringify(operations[index]?.payload),
  )

  if (patchedOperations.length) {
    const transaction = database.transaction('outbox', 'readwrite')
    await Promise.all(patchedOperations.map((operation) => transaction.store.put(operation)))
    await transaction.done
  }

  return normalizedOperations
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
  const categoryStore = transaction.objectStore('categories')
  const mergedCategoryChanges = await Promise.all(
    changes.categories.map(async (record) => {
      if (readCategorySortOrder(record) !== null) {
        return record
      }

      const existingRecord = (await categoryStore.get(String(record.id))) as Record<string, unknown> | undefined
      if (existingRecord && readCategorySortOrder(existingRecord) !== null) {
        return {
          ...record,
          sort_order: readCategorySortOrder(existingRecord),
        }
      }

      return record
    }),
  )
  const normalizedCategories = normalizeCategoryRecords(mergedCategoryChanges)

  await Promise.all([
    ...normalizedCategories.map((record) => categoryStore.put(record)),
    ...changes.todos.map((record) =>
      transaction.objectStore('todos').put({
        id: record.id,
        workspaceId: record.workspace_id,
        title: String(record.title ?? ''),
        categoryId:
          typeof record.category_id === 'string' ? record.category_id : null,
        dueDate: typeof record.due_date === 'string' ? record.due_date : null,
        myDayDate: typeof record.my_day_date === 'string' ? record.my_day_date : null,
        completedOn: typeof record.completed_on === 'string' ? record.completed_on : null,
        status: normalizeTodoStatus(record),
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
        status: normalizeEventStatus(record),
        allDay: normalizeEventAllDay(record),
        startAt: typeof record.start_at === 'string' ? record.start_at : null,
        endAt: typeof record.end_at === 'string' ? record.end_at : null,
        note: String(record.note ?? ''),
        updatedAt: record.updated_at,
        deleted: record.deleted,
      }),
    ),
  ])

  await transaction.done

  return normalizedCategories.length + changes.todos.length + changes.events.length
}

export const syncStoreAdapter: SyncStoreAdapter = {
  readSyncMeta,
  writeSyncMeta,
  listPendingOutbox,
  removeOutbox,
  bumpOutboxRetry,
  applyRemoteChanges,
}
