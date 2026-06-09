import Redis from "ioredis"
import type { ServerWebSocket } from "bun"
import type { ClientState } from "./ws-router"

export class RealtimeHub {
  private subscriber: Redis | null = null
  private publisher: Redis | null = null
  private readonly listeners = new Set<(userId: string) => void>()

  constructor(private readonly redisUrl: string | null) {}

  async start(onUserEvent: (userId: string) => void) {
    if (!this.redisUrl) return
    this.listeners.add(onUserEvent)
    this.publisher = new Redis(this.redisUrl)
    this.subscriber = new Redis(this.redisUrl)
    await this.subscriber.subscribe("kanna:user-events")
    this.subscriber.on("message", (_channel, payload) => {
      if (typeof payload !== "string" || !payload.startsWith("user:")) return
      const userId = payload.slice("user:".length)
      for (const listener of this.listeners) {
        listener(userId)
      }
    })
  }

  async publishUserUpdate(userId: string) {
    if (!this.publisher) return
    await this.publisher.publish("kanna:user-events", `user:${userId}`)
  }

  dispose() {
    this.subscriber?.disconnect()
    this.publisher?.disconnect()
    this.listeners.clear()
  }
}

export function filterSocketsForUser(
  sockets: Set<ServerWebSocket<ClientState>>,
  userId: string,
) {
  return [...sockets].filter((socket) => socket.data.userId === userId)
}
