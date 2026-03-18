import type { CategoryRecord, EventRecord, TodoRecord } from './local-types'
import {
  ensureSyncMeta,
  getCurrentWorkspaceMeta,
  listCategories,
  listEvents,
  listTodos,
  listPendingOutbox,
  syncStoreAdapter,
  writeOutbox,
  writeSyncMeta,
} from './db'
import { getAuthenticatedSupabaseClient } from './supabase'
import type {
  OutboxOperation,
  PullResult,
  PushResult,
  ReconcileResult,
  SyncCursor,
  SyncEntityName,
  SyncMeta,
  SyncOperationKind,
  SyncRecord,
} from './sync-types'

type RemoteEntityRecord = SyncRecord & {
  updated_at: string
}

function createDefaultCursor(): SyncCursor {
  return {
    categories: { updatedAt: null },
    todos: { updatedAt: null },
    events: { updatedAt: null },
  }
}

function mapEntityName(entity: SyncEntityName) {
  return entity === 'categories'
    ? 'category'
    : entity === 'todos'
      ? 'todo'
      : 'event'
}

export function createOutboxOperation(
  workspaceId: string,
  entity: SyncEntityName,
  kind: SyncOperationKind,
  payload: SyncRecord,
): OutboxOperation {
  return {
    id: `outbox-${crypto.randomUUID()}`,
    workspaceId,
    entity,
    kind,
    recordId: payload.id,
    payload,
    createdAt: new Date().toISOString(),
    retryCount: 0,
    lastError: null,
  }
}

export async function enqueueRecordMutation(
  entity: SyncEntityName,
  kind: SyncOperationKind,
  payload: SyncRecord,
) {
  const workspace = await getCurrentWorkspaceMeta()
  if (!workspace) {
    throw new Error('缺少工作区上下文，无法创建 outbox 操作。')
  }

  const operation = createOutboxOperation(workspace.workspaceId, entity, kind, payload)
  await writeOutbox(operation)
  return operation
}

export async function pushPendingOperations(): Promise<PushResult> {
  const workspace = await getCurrentWorkspaceMeta()
  if (!workspace) {
    return {
      pushedOperationIds: [],
      perEntityCount: {
        categories: 0,
        todos: 0,
        events: 0,
      },
    }
  }

  const meta = await ensureSyncMeta(workspace.workspaceId)
  const operations = await syncStoreAdapter.listPendingOutbox(workspace.workspaceId)
  const result: PushResult = {
    pushedOperationIds: operations.map((item) => item.id),
    perEntityCount: {
      categories: operations.filter((item) => item.entity === 'categories').length,
      todos: operations.filter((item) => item.entity === 'todos').length,
      events: operations.filter((item) => item.entity === 'events').length,
    },
  }

  if (!operations.length) {
    await writeSyncMeta({
      ...meta,
      status: 'idle',
      lastPushAt: meta.lastPushAt,
      lastError: null,
    })

    return result
  }

  await writeSyncMeta({
    ...meta,
    status: 'pushing',
    lastError: null,
  })

  try {
    const client = await getAuthenticatedSupabaseClient()

    for (const entity of ['categories', 'todos', 'events'] as const) {
      const entityOperations = operations.filter((item) => item.entity === entity)

      if (!entityOperations.length) {
        continue
      }

      const { error } = await client.from(entity).upsert(
        entityOperations.map((item) => item.payload),
        { onConflict: 'id' },
      )

      if (error) {
        throw new Error(`${mapEntityName(entity)} 同步失败：${error.message}`)
      }

      await syncStoreAdapter.removeOutbox(entityOperations.map((item) => item.id))
    }

    await writeSyncMeta({
      ...meta,
      status: 'idle',
      lastPushAt: new Date().toISOString(),
      lastError: null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知同步错误'

    await Promise.all(operations.map((item) => syncStoreAdapter.bumpOutboxRetry(item.id, message)))
    await writeSyncMeta({
      ...meta,
      status: 'error',
      lastError: message,
    })
    throw error
  }

  return result
}

export async function pullRemoteChanges(): Promise<PullResult> {
  const workspace = await getCurrentWorkspaceMeta()
  if (!workspace) {
    return {
      changes: {
        categories: [],
        todos: [],
        events: [],
      },
      nextCursor: createDefaultCursor(),
    }
  }

  const meta = await ensureSyncMeta(workspace.workspaceId)

  await writeSyncMeta({
    ...meta,
    status: 'pulling',
    lastError: null,
  })

  try {
    const client = await getAuthenticatedSupabaseClient()
    const nextCursor = createDefaultCursor()
    const changes: PullResult['changes'] = {
      categories: [],
      todos: [],
      events: [],
    }

    for (const entity of ['categories', 'todos', 'events'] as const) {
      let query = client
        .from(entity)
        .select('*')
        .eq('workspace_id', workspace.workspaceId)
        .order('updated_at', { ascending: true })

      const cursor = meta.cursor[entity].updatedAt
      if (cursor) {
        query = query.gt('updated_at', cursor)
      }

      const { data, error } = await query

      if (error) {
        throw new Error(`${mapEntityName(entity)} 拉取失败：${error.message}`)
      }

      const rows = (data ?? []) as RemoteEntityRecord[]
      changes[entity] = rows
      nextCursor[entity] = {
        updatedAt: rows.at(-1)?.updated_at ?? meta.cursor[entity].updatedAt,
      }
    }

    return {
      changes,
      nextCursor,
    }
  } catch (error) {
    await writeSyncMeta({
      ...meta,
      status: 'error',
      lastError: error instanceof Error ? error.message : '未知拉取错误',
    })
    throw error
  }
}

export async function reconcileRemoteChanges(
  workspaceId: string,
  result: PullResult,
): Promise<ReconcileResult> {
  const currentMeta = (await ensureSyncMeta(workspaceId)) satisfies SyncMeta
  const appliedCount = await syncStoreAdapter.applyRemoteChanges(result.changes)

  const nextMeta: SyncMeta = {
    ...currentMeta,
    status: 'idle',
    lastPullAt: new Date().toISOString(),
    lastError: null,
    cursor: result.nextCursor,
  }

  await writeSyncMeta(nextMeta)

  return {
    appliedCount,
    nextMeta,
  }
}

export type PhaseOneSnapshot = {
  workspaceId: string
  syncStatus: SyncMeta['status']
  anonymousUserId: string | null
  localCounts: {
    categories: number
    todos: number
    events: number
    pendingOutbox: number
  }
  cursor: SyncCursor
}

export async function loadPhaseOneSnapshot(): Promise<PhaseOneSnapshot | null> {
  const workspace = await getCurrentWorkspaceMeta()
  if (!workspace) {
    return null
  }

  const [meta, categories, todos, events, outbox] = await Promise.all([
    ensureSyncMeta(workspace.workspaceId),
    listCategories(workspace.workspaceId),
    listTodos(workspace.workspaceId),
    listEvents(workspace.workspaceId),
    listPendingOutbox(workspace.workspaceId),
  ])

  return {
    workspaceId: workspace.workspaceId,
    syncStatus: meta.status,
    anonymousUserId: workspace.anonymousUserId,
    localCounts: {
      categories: categories.filter((item) => !item.deleted).length,
      todos: todos.filter((item) => !item.deleted).length,
      events: events.filter((item) => !item.deleted).length,
      pendingOutbox: outbox.length,
    },
    cursor: meta.cursor,
  }
}

export function createCategorySeed(workspaceId: string): CategoryRecord {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    workspaceId,
    name: '默认分类',
    color: '#7c8f77',
    updatedAt: now,
    deleted: false,
  }
}

export function createTodoSeed(workspaceId: string, categoryId: string | null): TodoRecord {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    workspaceId,
    title: 'Phase 1 本地待办样本',
    categoryId,
    dueDate: now.slice(0, 10),
    myDayDate: null,
    status: 'not_started',
    completed: false,
    note: '用于验证本地 schema、outbox 和同步契约是否贯通。',
    recurrenceType: 'none',
    updatedAt: now,
    deleted: false,
  }
}

export function createEventSeed(workspaceId: string): EventRecord {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    workspaceId,
    title: 'Phase 1 日历样本',
    date: now.slice(0, 10),
    startAt: now,
    endAt: now,
    note: '用于验证事件本地存储结构。',
    updatedAt: now,
    deleted: false,
  }
}

export function inferEntityLabel(entity: SyncEntityName) {
  return mapEntityName(entity)
}
