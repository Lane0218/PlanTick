export const syncEntities = ['categories', 'todos', 'events'] as const

export type SyncEntityName = (typeof syncEntities)[number]

export type SyncOperationKind = 'upsert' | 'soft-delete'

export type SyncStatus = 'idle' | 'pushing' | 'pulling' | 'error'

export type SyncRecordBase = {
  id: string
  workspace_id: string
  updated_at: string
  deleted: boolean
}

export type SyncRecord = SyncRecordBase & Record<string, unknown>

export type OutboxOperation = {
  id: string
  workspaceId: string
  entity: SyncEntityName
  kind: SyncOperationKind
  recordId: string
  payload: SyncRecord
  createdAt: string
  retryCount: number
  lastError: string | null
}

export type SyncCursor = {
  [entity in SyncEntityName]: {
    updatedAt: string | null
  }
}

export type SyncMeta = {
  workspaceId: string
  status: SyncStatus
  lastPushAt: string | null
  lastPullAt: string | null
  lastError: string | null
  cursor: SyncCursor
}

export type RemoteChangeSet = {
  [entity in SyncEntityName]: SyncRecord[]
}

export type PushResult = {
  pushedOperationIds: string[]
  perEntityCount: Record<SyncEntityName, number>
}

export type PullResult = {
  changes: RemoteChangeSet
  nextCursor: SyncCursor
}

export type ReconcileResult = {
  appliedCount: number
  nextMeta: SyncMeta
}

export interface SyncStoreAdapter {
  readSyncMeta(workspaceId: string): Promise<SyncMeta | null>
  writeSyncMeta(meta: SyncMeta): Promise<void>
  listPendingOutbox(workspaceId: string, limit?: number): Promise<OutboxOperation[]>
  removeOutbox(operationIds: string[]): Promise<void>
  bumpOutboxRetry(operationId: string, lastError: string): Promise<void>
  applyRemoteChanges(changes: RemoteChangeSet): Promise<number>
}
