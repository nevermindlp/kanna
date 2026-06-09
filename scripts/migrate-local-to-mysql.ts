#!/usr/bin/env bun
import { homedir } from "node:os"
import { resolveKannaRuntimeConfig } from "../src/server/kanna-config"
import { createEventStoreRoot, LOCAL_USER_ID } from "../src/server/event-store-factory"
import { EventStore } from "../src/server/event-store"
import { getDb } from "../src/server/db/client"
import { runMigrations } from "../src/server/db/migrate"
import { chats, projects, queuedMessages, sidebarOrders, transcriptEntries } from "../src/server/db/schema"
import { randomUUID } from "node:crypto"

async function main() {
  const username = process.argv[2]?.trim()
  const userIdArg = process.argv[3]?.trim()
  if (!username) {
    console.error("Usage: bun run scripts/migrate-local-to-mysql.ts <username> [userId]")
    process.exit(1)
  }

  const config = resolveKannaRuntimeConfig({
    ...process.env,
    KANNA_STORAGE: "mysql",
    KANNA_AUTH_MODE: "multiuser",
  })

  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required")
  }

  await runMigrations(config.databaseUrl)
  const db = getDb(config.databaseUrl)

  const userId = userIdArg ?? randomUUID()
  await db.insert(projects).values([])

  const { users } = await import("../src/server/db/schema")
  const { hashPassword } = await import("../src/server/auth-shared")

  const existing = await db.select().from(users).where((await import("drizzle-orm")).eq(users.username, username)).limit(1)
  if (!existing[0]) {
    await db.insert(users).values({
      id: userId,
      username,
      passwordHash: await hashPassword("changeme123"),
      email: null,
      status: "active",
    })
    console.log(`Created user ${username} (${userId}) with temporary password changeme123`)
  } else {
    console.log(`Using existing user ${username} (${existing[0].id})`)
  }

  const resolvedUserId = existing[0]?.id ?? userId
  const localStore = new EventStore()
  await localStore.initialize()

  for (const project of localStore.listProjects()) {
    await db.insert(projects).values({
      id: project.id,
      userId: resolvedUserId,
      localPath: project.localPath,
      title: project.title,
      sidebarTitle: project.sidebarTitle ?? null,
      createdAt: new Date(project.createdAt),
      updatedAt: new Date(project.updatedAt),
      deletedAt: project.deletedAt ? new Date(project.deletedAt) : null,
    }).onDuplicateKeyUpdate({
      set: {
        title: project.title,
        updatedAt: new Date(project.updatedAt),
      },
    })
  }

  for (const chat of localStore.state.chatsById.values()) {
    await db.insert(chats).values({
      id: chat.id,
      userId: resolvedUserId,
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
      },
    })

    const messages = localStore.getMessages(chat.id)
    if (messages.length > 0) {
      await db.delete(transcriptEntries).where((await import("drizzle-orm")).and(
        (await import("drizzle-orm")).eq(transcriptEntries.chatId, chat.id),
        (await import("drizzle-orm")).eq(transcriptEntries.userId, resolvedUserId),
      ))
      await db.insert(transcriptEntries).values(messages.map((entry, index) => ({
        id: randomUUID(),
        chatId: chat.id,
        userId: resolvedUserId,
        seq: index,
        payload: entry,
        createdAt: new Date(entry.createdAt ?? Date.now()),
      })))
    }
  }

  const sidebarOrder = localStore.getSidebarProjectOrder()
  await db.insert(sidebarOrders).values({
    userId: resolvedUserId,
    projectIds: sidebarOrder,
  }).onDuplicateKeyUpdate({
    set: { projectIds: sidebarOrder },
  })

  for (const [chatId, entries] of localStore.state.queuedMessagesByChatId.entries()) {
    await db.delete(queuedMessages).where((await import("drizzle-orm")).eq(queuedMessages.chatId, chatId))
    await db.insert(queuedMessages).values(entries.map((entry, index) => ({
      id: entry.id,
      chatId,
      userId: resolvedUserId,
      queueOrder: index,
      payload: entry,
      createdAt: new Date(entry.createdAt),
    })))
  }

  console.log(`Migrated local store from ${homedir()} to MySQL for user ${username}`)
  void createEventStoreRoot(config)
  void LOCAL_USER_ID
}

void main()
