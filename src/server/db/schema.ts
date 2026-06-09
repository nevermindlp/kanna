import {
  boolean,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core"

export const users = mysqlTable("users", {
  id: varchar("id", { length: 36 }).primaryKey(),
  username: varchar("username", { length: 64 }).notNull(),
  passwordHash: text("password_hash").notNull(),
  email: varchar("email", { length: 255 }),
  status: mysqlEnum("status", ["active", "disabled"]).notNull().default("active"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("users_username_unique").on(table.username),
])

export const sessions = mysqlTable("sessions", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: varchar("user_id", { length: 36 }).notNull(),
  tokenHash: varchar("token_hash", { length: 128 }).notNull(),
  expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
  instanceId: varchar("instance_id", { length: 128 }),
  userAgent: varchar("user_agent", { length: 512 }),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
}, (table) => [
  index("sessions_user_id_idx").on(table.userId),
  uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
])

export const projects = mysqlTable("projects", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: varchar("user_id", { length: 36 }).notNull(),
  localPath: text("local_path").notNull(),
  title: varchar("title", { length: 512 }).notNull(),
  sidebarTitle: varchar("sidebar_title", { length: 512 }),
  createdAt: timestamp("created_at", { mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  deletedAt: timestamp("deleted_at", { mode: "date" }),
}, (table) => [
  index("projects_user_id_idx").on(table.userId),
  uniqueIndex("projects_user_local_path_unique").on(table.userId, table.localPath),
])

export const chats = mysqlTable("chats", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: varchar("user_id", { length: 36 }).notNull(),
  projectId: varchar("project_id", { length: 36 }).notNull(),
  title: varchar("title", { length: 512 }).notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  deletedAt: timestamp("deleted_at", { mode: "date" }),
  archivedAt: timestamp("archived_at", { mode: "date" }),
  unread: boolean("unread").notNull().default(false),
  provider: varchar("provider", { length: 32 }),
  planMode: boolean("plan_mode").notNull().default(false),
  sessionToken: text("session_token"),
  pendingForkSessionToken: text("pending_fork_session_token"),
  hasMessages: boolean("has_messages").notNull().default(false),
  lastMessageAt: timestamp("last_message_at", { mode: "date" }),
  lastTurnOutcome: mysqlEnum("last_turn_outcome", ["success", "failed", "cancelled"]),
}, (table) => [
  index("chats_user_id_idx").on(table.userId),
  index("chats_project_id_idx").on(table.projectId),
])

export const transcriptEntries = mysqlTable("transcript_entries", {
  id: varchar("id", { length: 36 }).primaryKey(),
  chatId: varchar("chat_id", { length: 36 }).notNull(),
  userId: varchar("user_id", { length: 36 }).notNull(),
  seq: int("seq").notNull(),
  payload: json("payload").notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).notNull(),
}, (table) => [
  index("transcript_entries_chat_id_seq_idx").on(table.chatId, table.seq),
  index("transcript_entries_user_id_idx").on(table.userId),
])

export const queuedMessages = mysqlTable("queued_messages", {
  id: varchar("id", { length: 36 }).primaryKey(),
  chatId: varchar("chat_id", { length: 36 }).notNull(),
  userId: varchar("user_id", { length: 36 }).notNull(),
  queueOrder: int("queue_order").notNull(),
  payload: json("payload").notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).notNull(),
}, (table) => [
  index("queued_messages_chat_id_idx").on(table.chatId, table.queueOrder),
])

export const userSettings = mysqlTable("user_settings", {
  userId: varchar("user_id", { length: 36 }).primaryKey(),
  settings: json("settings").notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
})

export const userProviders = mysqlTable("user_providers", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: varchar("user_id", { length: 36 }).notNull(),
  provider: mysqlEnum("provider", ["claude", "llm"]).notNull(),
  config: json("config").notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("user_providers_user_provider_unique").on(table.userId, table.provider),
])

export const userKeybindings = mysqlTable("user_keybindings", {
  userId: varchar("user_id", { length: 36 }).primaryKey(),
  bindings: json("bindings").notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
})

export const sidebarOrders = mysqlTable("sidebar_orders", {
  userId: varchar("user_id", { length: 36 }).primaryKey(),
  projectIds: json("project_ids").notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
})

export const attachmentObjects = mysqlTable("attachment_objects", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: varchar("user_id", { length: 36 }).notNull(),
  projectId: varchar("project_id", { length: 36 }).notNull(),
  objectKey: text("object_key").notNull(),
  fileName: varchar("file_name", { length: 512 }).notNull(),
  mimeType: varchar("mime_type", { length: 255 }),
  sizeBytes: int("size_bytes").notNull(),
  storageBackend: mysqlEnum("storage_backend", ["local", "object_storage"]).notNull().default("object_storage"),
  localCachePath: text("local_cache_path"),
  deletedAt: timestamp("deleted_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
}, (table) => [
  index("attachment_objects_user_project_idx").on(table.userId, table.projectId),
  index("attachment_objects_user_id_idx").on(table.userId),
])
