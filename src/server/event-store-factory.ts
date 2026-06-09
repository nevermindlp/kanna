import { homedir } from "node:os"
import { getDataDir } from "../shared/branding"
import { getDb } from "./db/client"
import { runMigrations } from "./db/migrate"
import type { IEventStoreRoot, IUserScopedEventStore } from "./event-store-types"
import { EventStore } from "./event-store"
import { LOCAL_USER_ID, type KannaRuntimeConfig } from "./kanna-config"
import { MySqlEventStoreRoot } from "./mysql-event-store"

class FileEventStoreRoot implements IEventStoreRoot {
  readonly isMultiTenant = false
  private readonly fileStore: EventStore

  constructor(dataDir?: string) {
    this.fileStore = new EventStore(dataDir)
  }

  get dataDir() {
    return this.fileStore.dataDir
  }

  async initialize() {
    await this.fileStore.initialize()
  }

  scope(_userId: string = LOCAL_USER_ID): IUserScopedEventStore {
    return this.fileStore as unknown as IUserScopedEventStore
  }

  async ensureScoped(_userId: string = LOCAL_USER_ID) {
    return this.scope(_userId)
  }

  async migrateLegacyTranscripts(onProgress?: (message: string) => void) {
    return this.fileStore.migrateLegacyTranscripts(onProgress)
  }

  get legacyStore() {
    return this.fileStore
  }
}

export type KannaEventStoreRoot = FileEventStoreRoot | MySqlEventStoreRoot

export async function createEventStoreRoot(config: KannaRuntimeConfig, dataDir?: string): Promise<KannaEventStoreRoot> {
  const resolvedDataDir = dataDir ?? getDataDir(homedir())

  if (config.storageMode === "mysql") {
    if (!config.databaseUrl) {
      throw new Error("DATABASE_URL is required for mysql storage")
    }
    await runMigrations(config.databaseUrl)
    const db = getDb(config.databaseUrl)
    const root = new MySqlEventStoreRoot(db, resolvedDataDir)
    await root.initialize()
    return root
  }

  const root = new FileEventStoreRoot(resolvedDataDir)
  await root.initialize()
  return root
}

export { LOCAL_USER_ID }
