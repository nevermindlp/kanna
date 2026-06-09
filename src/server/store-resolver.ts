import type { IEventStoreRoot, IUserScopedEventStore } from "./event-store-types"
import { LOCAL_USER_ID } from "./kanna-config"
import type { MySqlEventStoreRoot } from "./mysql-event-store"

export class StoreResolver {
  constructor(private readonly root: IEventStoreRoot) {}

  get dataDir() {
    return this.root.dataDir
  }

  get isMultiTenant() {
    return this.root.isMultiTenant
  }

  async initialize() {
    await this.root.initialize()
  }

  async migrateLegacyTranscripts(onProgress?: (message: string) => void) {
    return this.root.migrateLegacyTranscripts(onProgress)
  }

  async forUser(userId: string = LOCAL_USER_ID): Promise<IUserScopedEventStore> {
    if (this.root.isMultiTenant) {
      return (this.root as MySqlEventStoreRoot).ensureScoped(userId)
    }
    return this.root.scope(userId)
  }

  async compact(userId: string = LOCAL_USER_ID) {
    if (this.root.isMultiTenant) return
    const legacy = this.root as { legacyStore?: { compact: () => Promise<void> } }
    if (legacy.legacyStore?.compact) {
      await legacy.legacyStore.compact()
    } else if ("compact" in this.root.scope(userId)) {
      await (this.root.scope(userId) as unknown as EventStoreWithCompact).compact()
    }
  }
}

interface EventStoreWithCompact {
  compact: () => Promise<void>
}
