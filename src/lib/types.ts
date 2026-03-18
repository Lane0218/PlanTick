export type EntityId = string
export type IsoDatetime = string
export type SyncStatus = 'pending' | 'processing' | 'failed' | 'synced'
export type EntityType = 'category' | 'todo' | 'event'

export type WorkspaceMeta = {
  key: 'current'
  workspaceId: string
  anonymousUserId: string | null
  joinedAt: IsoDatetime
  lastSeenAt: IsoDatetime
  lastProbeId: string | null
}

export type WorkspaceSettingsInfo = {
  workspaceId: string
  anonymousUserId: string | null
  joinedAt: IsoDatetime
  lastSeenAt: IsoDatetime
  createdAt: IsoDatetime | null
  syncStatus: {
    status: 'idle' | 'pushing' | 'pulling' | 'error'
    lastPushAt: IsoDatetime | null
    lastPullAt: IsoDatetime | null
    pendingOutboxCount: number
    lastError: string | null
  }
}

export type SyncMeta = {
  key: string
  value: string
  updatedAt: IsoDatetime
}

export type CategoryRecord = {
  id: EntityId
  workspaceId: string
  name: string
  color: string
  updatedAt: IsoDatetime
  deleted: boolean
}

export type TodoRecurrenceType = 'none' | 'daily' | 'weekly' | 'monthly'
export type TodoStatus = 'not_started' | 'in_progress' | 'completed' | 'blocked' | 'canceled'

export type TodoRecord = {
  id: EntityId
  workspaceId: string
  title: string
  categoryId: EntityId | null
  dueDate: string | null
  myDayDate: string | null
  status: TodoStatus
  completed: boolean
  note: string
  recurrenceType: TodoRecurrenceType
  updatedAt: IsoDatetime
  deleted: boolean
}

export type EventRecord = {
  id: EntityId
  workspaceId: string
  title: string
  date: string
  startAt: IsoDatetime | null
  endAt: IsoDatetime | null
  note: string
  updatedAt: IsoDatetime
  deleted: boolean
}

export type OutboxOperationType =
  | 'category.upsert'
  | 'category.delete'
  | 'todo.upsert'
  | 'todo.delete'
  | 'event.upsert'
  | 'event.delete'

export type OutboxPayload =
  | CategoryRecord
  | TodoRecord
  | EventRecord
  | {
      id: EntityId
      workspaceId: string
      updatedAt: IsoDatetime
      deleted: true
    }

export type OutboxItem = {
  id: EntityId
  workspaceId: string
  entityType: EntityType
  entityId: EntityId
  operation: OutboxOperationType
  payload: OutboxPayload
  status: SyncStatus
  retryCount: number
  lastError: string | null
  createdAt: IsoDatetime
  updatedAt: IsoDatetime
}

export type PhaseOneSummary = {
  workspaceId: string
  categoryCount: number
  todoCount: number
  eventCount: number
  pendingOutboxCount: number
  lastSyncCursor: string | null
}
