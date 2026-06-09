import { AsyncLocalStorage } from "node:async_hooks"
import type { IUserScopedEventStore } from "./event-store-types"
import type { StoreResolver } from "./store-resolver"
import type { AgentCoordinator } from "./agent"

type AgentStoreBinder = Pick<AgentCoordinator, "bindUserStore"> | { bindUserStore?: AgentCoordinator["bindUserStore"] }

const storeContext = new AsyncLocalStorage<IUserScopedEventStore>()
const userIdContext = new AsyncLocalStorage<string>()

export function getActiveEventStore() {
  const store = storeContext.getStore()
  if (!store) {
    throw new Error("Event store context is not bound")
  }
  return store
}

export async function withUserEventStore<T>(
  storeResolver: StoreResolver,
  agent: AgentStoreBinder,
  userId: string,
  fn: () => Promise<T>,
) {
  const store = await storeResolver.forUser(userId)
  agent.bindUserStore?.(store)
  return userIdContext.run(userId, () => storeContext.run(store, fn))
}

export function tryGetActiveUserId() {
  return userIdContext.getStore() ?? null
}

export function tryGetActiveEventStore() {
  return storeContext.getStore() ?? null
}
