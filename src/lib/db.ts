import { openDB } from 'idb'

const databaseName = 'plantick-phase0'
const storeName = 'phase0_meta'

function createProbeId() {
  if (typeof crypto.randomUUID === 'function') {
    return `probe-${crypto.randomUUID()}`
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `probe-${hex}`
}

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
  const probeId = createProbeId()
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
