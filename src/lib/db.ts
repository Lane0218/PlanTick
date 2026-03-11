import { openDB } from 'idb'

const databaseName = 'plantick-phase0'
const storeName = 'phase0_meta'

async function getDatabase() {
  return openDB(databaseName, 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(storeName)) {
        database.createObjectStore(storeName)
      }
    },
  })
}

export async function runIndexedDbProbe() {
  const database = await getDatabase()
  const probeId = `probe-${crypto.randomUUID()}`
  await database.put(storeName, probeId, 'lastProbeId')
  return probeId
}

export async function saveWorkspaceId(workspaceId: string) {
  const database = await getDatabase()
  await database.put(storeName, workspaceId, 'workspaceId')
}

export async function loadWorkspaceId() {
  const database = await getDatabase()
  const workspaceId = await database.get(storeName, 'workspaceId')
  return typeof workspaceId === 'string' ? workspaceId : ''
}
