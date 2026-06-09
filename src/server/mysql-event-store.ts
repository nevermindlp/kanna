import { randomUUID } from "node:crypto"
import path from "node:path"
import { and, asc, eq } from "drizzle-orm"
import type { AgentProvider, ChatHistoryPage, ChatHistorySnapshot, QueuedChatMessage, TranscriptEntry } from "../shared/types"
import type { KannaDatabase } from "./db/client"
import {
  chats,
  projects,
  queuedMessages,
  sidebarOrders,
  transcriptEntries,
} from "./db/schema"
import type { ChatRecord, ProjectRecord, StoreState } from "./events"
import { cloneTranscriptEntries } from "./events"
import { emptyStoreState, type IEventStoreRoot, type IUserScopedEventStore } from "./event-store-types"
import { resolveLocalPath } from "./paths"

const STALE_EMPTY_CHAT_MAX_AGE_MS = 30 * 60 * 1000

function encodeHistoryCursor(index: number) {
  return `idx:${index}`
}

function decodeCursor(cursor: string) {
  if (cursor.startsWith("idx:")) {
    const value = Number.parseInt(cursor.slice("idx:".length), 10)
    return Number.isFinite(value) ? value : 0
  }
  return 0
}

function transcriptEntryTimestamp(entry: TranscriptEntry) {
  return entry.createdAt ?? Date.now()
}

function getHistorySnapshot(page: {
  entries: TranscriptEntry[]
  hasOlder: boolean
  olderCursor: string | null
}, recentLimit: number): ChatHistorySnapshot {
  return {
    recentLimit,
    hasOlder: page.hasOlder,
    olderCursor: page.olderCursor,
  }
}

function getForkedChatTitle(title: string) {
  const trimmed = title.trim()
  if (!trimmed) return "Forked Chat"
  if (trimmed.toLowerCase().startsWith("fork of ")) return trimmed
  return `Fork of ${trimmed}`
}

function rowToProject(row: typeof projects.$inferSelect): ProjectRecord {
  return {
    id: row.id,
    localPath: row.localPath,
    title: row.title,
    sidebarTitle: row.sidebarTitle ?? undefined,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    deletedAt: row.deletedAt?.getTime(),
  }
}

function rowToChat(row: typeof chats.$inferSelect): ChatRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    deletedAt: row.deletedAt?.getTime(),
    archivedAt: row.archivedAt?.getTime(),
    unread: row.unread,
    provider: (row.provider as AgentProvider | null) ?? null,
    planMode: row.planMode,
    sessionToken: row.sessionToken ?? null,
    pendingForkSessionToken: row.pendingForkSessionToken ?? null,
    hasMessages: row.hasMessages,
    lastMessageAt: row.lastMessageAt?.getTime(),
    lastTurnOutcome: row.lastTurnOutcome ?? null,
  }
}

export class MySqlScopedEventStore implements IUserScopedEventStore {
  private transcriptCache = new Map<string, TranscriptEntry[]>()
  private sidebarProjectOrder: string[]

  constructor(
    readonly userId: string,
    private readonly db: KannaDatabase,
    readonly state: StoreState,
    sidebarProjectOrder: string[],
  ) {
    this.sidebarProjectOrder = sidebarProjectOrder
  }

  async initialize() {}

  private async persistProject(project: ProjectRecord) {
    await this.db.insert(projects).values({
      id: project.id,
      userId: this.userId,
      localPath: project.localPath,
      title: project.title,
      sidebarTitle: project.sidebarTitle ?? null,
      createdAt: new Date(project.createdAt),
      updatedAt: new Date(project.updatedAt),
      deletedAt: project.deletedAt ? new Date(project.deletedAt) : null,
    }).onDuplicateKeyUpdate({
      set: {
        title: project.title,
        sidebarTitle: project.sidebarTitle ?? null,
        updatedAt: new Date(project.updatedAt),
        deletedAt: project.deletedAt ? new Date(project.deletedAt) : null,
      },
    })
  }

  private async persistChat(chat: ChatRecord) {
    await this.db.insert(chats).values({
      id: chat.id,
      userId: this.userId,
      projectId: chat.projectId,
      title: chat.title,
      createdAt: new Date(chat.createdAt),
      updatedAt: new Date(chat.updatedAt),
      deletedAt: chat.deletedAt ? new Date(chat.deletedAt) : null,
      archivedAt: chat.archivedAt ? new Date(chat.archivedAt) : null,
      unread: chat.unread,
      provider: chat.provider,
      planMode: chat.planMode,
      sessionToken: chat.sessionToken,
      pendingForkSessionToken: chat.pendingForkSessionToken ?? null,
      hasMessages: Boolean(chat.hasMessages),
      lastMessageAt: chat.lastMessageAt ? new Date(chat.lastMessageAt) : null,
      lastTurnOutcome: chat.lastTurnOutcome,
    }).onDuplicateKeyUpdate({
      set: {
        title: chat.title,
        updatedAt: new Date(chat.updatedAt),
        deletedAt: chat.deletedAt ? new Date(chat.deletedAt) : null,
        archivedAt: chat.archivedAt ? new Date(chat.archivedAt) : null,
        unread: chat.unread,
        provider: chat.provider,
        planMode: chat.planMode,
        sessionToken: chat.sessionToken,
        pendingForkSessionToken: chat.pendingForkSessionToken ?? null,
        hasMessages: Boolean(chat.hasMessages),
        lastMessageAt: chat.lastMessageAt ? new Date(chat.lastMessageAt) : null,
        lastTurnOutcome: chat.lastTurnOutcome,
      },
    })
  }

  async openProject(localPath: string, title?: string) {
    const normalized = resolveLocalPath(localPath)
    const existingId = this.state.projectIdsByPath.get(normalized)
    if (existingId) {
      const existing = this.state.projectsById.get(existingId)
      if (existing && !existing.deletedAt) return existing
    }

    const hiddenProject = [...this.state.projectsById.values()]
      .find((project) => project.localPath === normalized && project.deletedAt)
    const now = Date.now()
    const project: ProjectRecord = {
      id: hiddenProject?.id ?? randomUUID(),
      localPath: normalized,
      title: title?.trim() || path.basename(normalized) || normalized,
      createdAt: hiddenProject?.createdAt ?? now,
      updatedAt: now,
      deletedAt: undefined,
      sidebarTitle: hiddenProject?.sidebarTitle,
    }
    this.state.projectsById.set(project.id, project)
    this.state.projectIdsByPath.set(normalized, project.id)
    await this.persistProject(project)
    return project
  }

  async removeProject(projectId: string) {
    const project = this.getProject(projectId)
    if (!project) throw new Error("Project not found")
    project.deletedAt = Date.now()
    project.updatedAt = Date.now()
    await this.persistProject(project)
  }

  async renameProjectSidebarTitle(projectId: string, title: string) {
    const project = this.getProject(projectId)
    if (!project) throw new Error("Project not found")
    project.sidebarTitle = title.trim() || undefined
    project.updatedAt = Date.now()
    await this.persistProject(project)
  }

  async setSidebarProjectOrder(projectIds: string[]) {
    const validProjectIds = projectIds.filter((projectId) => {
      const project = this.state.projectsById.get(projectId)
      return Boolean(project && !project.deletedAt)
    })
    this.sidebarProjectOrder = [...new Set(validProjectIds)]
    await this.db.insert(sidebarOrders).values({
      userId: this.userId,
      projectIds: this.sidebarProjectOrder,
    }).onDuplicateKeyUpdate({
      set: { projectIds: this.sidebarProjectOrder },
    })
  }

  async createChat(projectId: string) {
    const project = this.state.projectsById.get(projectId)
    if (!project || project.deletedAt) throw new Error("Project not found")
    const now = Date.now()
    const chat: ChatRecord = {
      id: randomUUID(),
      projectId,
      title: "New Chat",
      createdAt: now,
      updatedAt: now,
      unread: false,
      provider: null,
      planMode: false,
      sessionToken: null,
      pendingForkSessionToken: null,
      hasMessages: false,
      lastTurnOutcome: null,
    }
    this.state.chatsById.set(chat.id, chat)
    await this.persistChat(chat)
    return chat
  }

  async forkChat(sourceChatId: string) {
    const sourceChat = this.requireChat(sourceChatId)
    const sourceSessionToken = sourceChat.sessionToken ?? sourceChat.pendingForkSessionToken ?? null
    if (!sourceChat.provider || !sourceSessionToken) throw new Error("Chat cannot be forked")

    const chat = await this.createChat(sourceChat.projectId)
    chat.title = getForkedChatTitle(sourceChat.title)
    chat.provider = sourceChat.provider
    chat.planMode = sourceChat.planMode
    chat.pendingForkSessionToken = sourceSessionToken
    await this.persistChat(chat)

    const sourceEntries = await this.ensureMessagesLoaded(sourceChatId)
    if (sourceEntries.length > 0) {
      await this.writeTranscriptEntries(chat.id, sourceEntries)
      chat.hasMessages = true
      chat.updatedAt = Date.now()
      await this.persistChat(chat)
    }
    return chat
  }

  async renameChat(chatId: string, title: string) {
    const trimmed = title.trim()
    if (!trimmed) return
    const chat = this.requireChat(chatId)
    if (chat.title === trimmed) return
    chat.title = trimmed
    chat.updatedAt = Date.now()
    await this.persistChat(chat)
  }

  async deleteChat(chatId: string) {
    const chat = this.requireChat(chatId)
    chat.deletedAt = Date.now()
    chat.updatedAt = Date.now()
    await this.persistChat(chat)
  }

  async archiveChat(chatId: string) {
    const chat = this.requireChat(chatId)
    chat.archivedAt = Date.now()
    chat.updatedAt = Date.now()
    await this.persistChat(chat)
  }

  async unarchiveChat(chatId: string) {
    const chat = this.requireChat(chatId)
    chat.archivedAt = undefined
    chat.updatedAt = Date.now()
    await this.persistChat(chat)
  }

  async pruneStaleEmptyChats(args?: { now?: number; protectedChatIds?: Set<string> }) {
    const now = args?.now ?? Date.now()
    const protectedChatIds = args?.protectedChatIds ?? new Set<string>()
    const pruned: string[] = []
    for (const chat of this.state.chatsById.values()) {
      if (chat.deletedAt || chat.archivedAt || chat.hasMessages) continue
      if (protectedChatIds.has(chat.id)) continue
      if (now - chat.createdAt < STALE_EMPTY_CHAT_MAX_AGE_MS) continue
      chat.deletedAt = now
      chat.updatedAt = now
      await this.persistChat(chat)
      pruned.push(chat.id)
    }
    return pruned
  }

  async setChatProvider(chatId: string, provider: AgentProvider) {
    const chat = this.requireChat(chatId)
    chat.provider = provider
    chat.updatedAt = Date.now()
    await this.persistChat(chat)
  }

  async setPlanMode(chatId: string, planMode: boolean) {
    const chat = this.requireChat(chatId)
    chat.planMode = planMode
    chat.updatedAt = Date.now()
    await this.persistChat(chat)
  }

  async setChatReadState(chatId: string, unread: boolean) {
    const chat = this.requireChat(chatId)
    chat.unread = unread
    chat.updatedAt = Date.now()
    await this.persistChat(chat)
  }

  private async writeTranscriptEntries(chatId: string, entries: TranscriptEntry[]) {
    await this.db.delete(transcriptEntries).where(and(
      eq(transcriptEntries.chatId, chatId),
      eq(transcriptEntries.userId, this.userId),
    ))
    if (entries.length === 0) {
      this.transcriptCache.set(chatId, [])
      return
    }
    await this.db.insert(transcriptEntries).values(entries.map((entry, index) => ({
      id: randomUUID(),
      chatId,
      userId: this.userId,
      seq: index,
      payload: entry,
      createdAt: new Date(transcriptEntryTimestamp(entry)),
    })))
    this.transcriptCache.set(chatId, cloneTranscriptEntries(entries))
  }

  async appendMessage(chatId: string, entry: TranscriptEntry) {
    this.requireChat(chatId)
    const entries = await this.ensureMessagesLoaded(chatId)
    entries.push(entry)
    await this.db.insert(transcriptEntries).values({
      id: randomUUID(),
      chatId,
      userId: this.userId,
      seq: entries.length - 1,
      payload: entry,
      createdAt: new Date(transcriptEntryTimestamp(entry)),
    })
    this.transcriptCache.set(chatId, entries)

    const chat = this.requireChat(chatId)
    chat.hasMessages = true
    chat.updatedAt = Date.now()
    chat.lastMessageAt = transcriptEntryTimestamp(entry)
    await this.persistChat(chat)
  }

  async enqueueMessage(chatId: string, message: Omit<QueuedChatMessage, "id" | "createdAt"> & Partial<Pick<QueuedChatMessage, "id" | "createdAt">>) {
    this.requireChat(chatId)
    const queued: QueuedChatMessage = {
      id: message.id ?? randomUUID(),
      createdAt: message.createdAt ?? Date.now(),
      content: message.content,
      attachments: [...(message.attachments ?? [])],
      provider: message.provider,
      model: message.model,
      modelOptions: message.modelOptions,
      planMode: message.planMode,
    }
    const current = this.getQueuedMessages(chatId)
    current.push(queued)
    this.state.queuedMessagesByChatId.set(chatId, current)
    await this.db.insert(queuedMessages).values({
      id: queued.id,
      chatId,
      userId: this.userId,
      queueOrder: current.length - 1,
      payload: queued,
      createdAt: new Date(queued.createdAt),
    })
    return queued
  }

  async removeQueuedMessage(chatId: string, queuedMessageId: string) {
    const current = this.getQueuedMessages(chatId).filter((entry) => entry.id !== queuedMessageId)
    this.state.queuedMessagesByChatId.set(chatId, current)
    await this.db.delete(queuedMessages).where(and(
      eq(queuedMessages.chatId, chatId),
      eq(queuedMessages.userId, this.userId),
    ))
    if (current.length > 0) {
      await this.db.insert(queuedMessages).values(current.map((entry, index) => ({
        id: entry.id,
        chatId,
        userId: this.userId,
        queueOrder: index,
        payload: entry,
        createdAt: new Date(entry.createdAt),
      })))
    }
  }

  async recordTurnStarted(chatId: string) {
    const chat = this.requireChat(chatId)
    chat.updatedAt = Date.now()
    await this.persistChat(chat)
  }

  async recordTurnFinished(chatId: string) {
    const chat = this.requireChat(chatId)
    chat.lastTurnOutcome = "success"
    chat.updatedAt = Date.now()
    await this.persistChat(chat)
  }

  async recordTurnFailed(chatId: string, _error: string) {
    const chat = this.requireChat(chatId)
    chat.lastTurnOutcome = "failed"
    chat.updatedAt = Date.now()
    await this.persistChat(chat)
  }

  async recordTurnCancelled(chatId: string) {
    const chat = this.requireChat(chatId)
    chat.lastTurnOutcome = "cancelled"
    chat.updatedAt = Date.now()
    await this.persistChat(chat)
  }

  async setSessionToken(chatId: string, sessionToken: string | null) {
    const chat = this.requireChat(chatId)
    chat.sessionToken = sessionToken
    chat.updatedAt = Date.now()
    await this.persistChat(chat)
  }

  async setPendingForkSessionToken(chatId: string, pendingForkSessionToken: string | null) {
    const chat = this.requireChat(chatId)
    chat.pendingForkSessionToken = pendingForkSessionToken
    chat.updatedAt = Date.now()
    await this.persistChat(chat)
  }

  getProject(projectId: string) {
    const project = this.state.projectsById.get(projectId)
    if (!project || project.deletedAt) return null
    return project
  }

  requireChat(chatId: string) {
    const chat = this.state.chatsById.get(chatId)
    if (!chat || chat.deletedAt) throw new Error("Chat not found")
    return chat
  }

  getChat(chatId: string) {
    const chat = this.state.chatsById.get(chatId)
    if (!chat || chat.deletedAt) return null
    return chat
  }

  getSidebarProjectOrder() {
    return [...this.sidebarProjectOrder]
  }

  async ensureMessagesLoaded(chatId: string) {
    const cached = this.transcriptCache.get(chatId)
    if (cached) return cached
    const rows = await this.db
      .select({ payload: transcriptEntries.payload })
      .from(transcriptEntries)
      .where(and(eq(transcriptEntries.chatId, chatId), eq(transcriptEntries.userId, this.userId)))
      .orderBy(asc(transcriptEntries.seq))
    const entries = rows.map((row) => row.payload as TranscriptEntry)
    this.transcriptCache.set(chatId, entries)
    return entries
  }

  getMessages(chatId: string) {
    const cached = this.transcriptCache.get(chatId)
    return cached ? cloneTranscriptEntries(cached) : []
  }

  getQueuedMessages(chatId: string) {
    return (this.state.queuedMessagesByChatId.get(chatId) ?? []).map((entry) => ({
      ...entry,
      attachments: [...entry.attachments],
    }))
  }

  getQueuedMessage(chatId: string, queuedMessageId: string) {
    return this.getQueuedMessages(chatId).find((entry) => entry.id === queuedMessageId) ?? null
  }

  private getMessagesPageFromEntries(entries: TranscriptEntry[], limit: number, beforeIndex?: number) {
    if (entries.length === 0) {
      return { entries: [], hasOlder: false, olderCursor: null }
    }
    const endIndex = beforeIndex === undefined ? entries.length : Math.max(0, Math.min(beforeIndex, entries.length))
    const startIndex = Math.max(0, endIndex - limit)
    return {
      entries: cloneTranscriptEntries(entries.slice(startIndex, endIndex)),
      hasOlder: startIndex > 0,
      olderCursor: startIndex > 0 ? encodeHistoryCursor(startIndex) : null,
    }
  }

  getRecentMessagesPage(chatId: string, limit: number): ChatHistoryPage {
    const entries = this.getMessages(chatId)
    const page = this.getMessagesPageFromEntries(entries, limit)
    return { messages: page.entries, hasOlder: page.hasOlder, olderCursor: page.olderCursor }
  }

  getMessagesPageBefore(chatId: string, beforeCursor: string, limit: number): ChatHistoryPage {
    const entries = this.getMessages(chatId)
    const page = this.getMessagesPageFromEntries(entries, limit, decodeCursor(beforeCursor))
    return { messages: page.entries, hasOlder: page.hasOlder, olderCursor: page.olderCursor }
  }

  getRecentChatHistory(chatId: string, recentLimit: number) {
    const page = this.getRecentMessagesPage(chatId, recentLimit)
    return {
      messages: page.messages,
      history: getHistorySnapshot({
        entries: page.messages,
        hasOlder: page.hasOlder,
        olderCursor: page.olderCursor,
      }, recentLimit),
    }
  }

  listProjects() {
    return [...this.state.projectsById.values()].filter((project) => !project.deletedAt)
  }

  listChatsByProject(projectId: string) {
    return [...this.state.chatsById.values()]
      .filter((chat) => chat.projectId === projectId && !chat.deletedAt && !chat.archivedAt)
      .sort((a, b) => (b.lastMessageAt ?? b.updatedAt) - (a.lastMessageAt ?? a.updatedAt))
  }

  getChatCount(projectId: string) {
    return this.listChatsByProject(projectId).length
  }

  async migrateLegacyTranscripts() {
    return false
  }
}

export class MySqlEventStoreRoot implements IEventStoreRoot {
  readonly dataDir: string
  readonly isMultiTenant = true
  private scopedCache = new Map<string, MySqlScopedEventStore>()

  constructor(
    private readonly db: KannaDatabase,
    dataDir: string,
  ) {
    this.dataDir = dataDir
  }

  async initialize() {}

  async ensureScoped(userId: string) {
    let scoped = this.scopedCache.get(userId)
    if (scoped) return scoped

    const state = emptyStoreState()
    const projectRows = await this.db.select().from(projects).where(eq(projects.userId, userId))
    for (const row of projectRows) {
      const project = rowToProject(row)
      state.projectsById.set(project.id, project)
      if (!project.deletedAt) {
        state.projectIdsByPath.set(project.localPath, project.id)
      }
    }

    const chatRows = await this.db.select().from(chats).where(eq(chats.userId, userId))
    for (const row of chatRows) {
      state.chatsById.set(row.id, rowToChat(row))
    }

    const queuedRows = await this.db
      .select()
      .from(queuedMessages)
      .where(eq(queuedMessages.userId, userId))
      .orderBy(asc(queuedMessages.queueOrder))
    for (const row of queuedRows) {
      const list = state.queuedMessagesByChatId.get(row.chatId) ?? []
      list.push(row.payload as QueuedChatMessage)
      state.queuedMessagesByChatId.set(row.chatId, list)
    }

    const sidebarRows = await this.db.select().from(sidebarOrders).where(eq(sidebarOrders.userId, userId)).limit(1)
    const sidebarProjectOrder = Array.isArray(sidebarRows[0]?.projectIds)
      ? sidebarRows[0]!.projectIds as string[]
      : []

    scoped = new MySqlScopedEventStore(userId, this.db, state, sidebarProjectOrder)
    this.scopedCache.set(userId, scoped)
    return scoped
  }

  scope(userId: string): IUserScopedEventStore {
    const cached = this.scopedCache.get(userId)
    if (!cached) {
      throw new Error(`Event store scope for user ${userId} is not loaded`)
    }
    return cached
  }

  invalidateScope(userId: string) {
    this.scopedCache.delete(userId)
  }

  async migrateLegacyTranscripts() {
    return false
  }
}
