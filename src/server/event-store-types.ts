import type { AgentProvider, ChatHistoryPage, ChatHistorySnapshot, QueuedChatMessage, TranscriptEntry } from "../shared/types"
import type { ChatRecord, ProjectRecord, StoreState } from "./events"
import { createEmptyState } from "./events"

export interface IUserScopedEventStore {
  readonly userId: string
  readonly state: StoreState
  initialize(): Promise<void>
  openProject(localPath: string, title?: string): Promise<ProjectRecord>
  removeProject(projectId: string): Promise<void>
  renameProjectSidebarTitle(projectId: string, title: string): Promise<void>
  setSidebarProjectOrder(projectIds: string[]): Promise<void>
  createChat(projectId: string): Promise<ChatRecord>
  forkChat(sourceChatId: string): Promise<ChatRecord>
  renameChat(chatId: string, title: string): Promise<void>
  deleteChat(chatId: string): Promise<void>
  archiveChat(chatId: string): Promise<void>
  unarchiveChat(chatId: string): Promise<void>
  pruneStaleEmptyChats(args?: {
    now?: number
    protectedChatIds?: Set<string>
  }): Promise<string[]>
  setChatProvider(chatId: string, provider: AgentProvider): Promise<void>
  setPlanMode(chatId: string, planMode: boolean): Promise<void>
  setChatReadState(chatId: string, unread: boolean): Promise<void>
  appendMessage(chatId: string, entry: TranscriptEntry): Promise<void>
  enqueueMessage(chatId: string, message: Omit<QueuedChatMessage, "id" | "createdAt"> & Partial<Pick<QueuedChatMessage, "id" | "createdAt">>): Promise<QueuedChatMessage>
  removeQueuedMessage(chatId: string, queuedMessageId: string): Promise<void>
  recordTurnStarted(chatId: string): Promise<void>
  recordTurnFinished(chatId: string): Promise<void>
  recordTurnFailed(chatId: string, error: string): Promise<void>
  recordTurnCancelled(chatId: string): Promise<void>
  setSessionToken(chatId: string, sessionToken: string | null): Promise<void>
  setPendingForkSessionToken(chatId: string, pendingForkSessionToken: string | null): Promise<void>
  getProject(projectId: string): ProjectRecord | null
  requireChat(chatId: string): ChatRecord
  getChat(chatId: string): ChatRecord | null
  getSidebarProjectOrder(): string[]
  getMessages(chatId: string): TranscriptEntry[]
  getQueuedMessages(chatId: string): QueuedChatMessage[]
  getQueuedMessage(chatId: string, queuedMessageId: string): QueuedChatMessage | null
  getRecentMessagesPage(chatId: string, limit: number): ChatHistoryPage
  getMessagesPageBefore(chatId: string, beforeCursor: string, limit: number): ChatHistoryPage
  getRecentChatHistory(chatId: string, recentLimit: number): {
    messages: TranscriptEntry[]
    history: ChatHistorySnapshot
  }
  listProjects(): ProjectRecord[]
  listChatsByProject(projectId: string): ChatRecord[]
  getChatCount(projectId: string): number
  migrateLegacyTranscripts(onProgress?: (message: string) => void): Promise<boolean>
}

export interface IEventStoreRoot {
  readonly dataDir: string
  readonly isMultiTenant: boolean
  initialize(): Promise<void>
  scope(userId: string): IUserScopedEventStore
  migrateLegacyTranscripts(onProgress?: (message: string) => void): Promise<boolean>
}

export function cloneStoreState(state: StoreState): StoreState {
  return {
    projectsById: new Map([...state.projectsById.entries()].map(([id, project]) => [id, { ...project }])),
    projectIdsByPath: new Map(state.projectIdsByPath),
    chatsById: new Map([...state.chatsById.entries()].map(([id, chat]) => [id, { ...chat }])),
    queuedMessagesByChatId: new Map([...state.queuedMessagesByChatId.entries()].map(([id, entries]) => [
      id,
      entries.map((entry) => ({ ...entry, attachments: [...entry.attachments] })),
    ])),
  }
}

export function emptyStoreState(): StoreState {
  return createEmptyState()
}
