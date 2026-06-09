import mysql from "mysql2/promise"

const MIGRATION_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY,
    username VARCHAR(64) NOT NULL,
    password_hash TEXT NOT NULL,
    email VARCHAR(255) NULL,
    status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY users_username_unique (username)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    token_hash VARCHAR(128) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    instance_id VARCHAR(128) NULL,
    user_agent VARCHAR(512) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY sessions_token_hash_unique (token_hash),
    KEY sessions_user_id_idx (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS projects (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    local_path TEXT NOT NULL,
    title VARCHAR(512) NOT NULL,
    sidebar_title VARCHAR(512) NULL,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    deleted_at TIMESTAMP NULL,
    UNIQUE KEY projects_user_local_path_unique (user_id, local_path(255)),
    KEY projects_user_id_idx (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS chats (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    project_id VARCHAR(36) NOT NULL,
    title VARCHAR(512) NOT NULL,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    deleted_at TIMESTAMP NULL,
    archived_at TIMESTAMP NULL,
    unread TINYINT(1) NOT NULL DEFAULT 0,
    provider VARCHAR(32) NULL,
    plan_mode TINYINT(1) NOT NULL DEFAULT 0,
    session_token TEXT NULL,
    pending_fork_session_token TEXT NULL,
    has_messages TINYINT(1) NOT NULL DEFAULT 0,
    last_message_at TIMESTAMP NULL,
    last_turn_outcome ENUM('success', 'failed', 'cancelled') NULL,
    KEY chats_user_id_idx (user_id),
    KEY chats_project_id_idx (project_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS transcript_entries (
    id VARCHAR(36) PRIMARY KEY,
    chat_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    seq INT NOT NULL,
    payload JSON NOT NULL,
    created_at TIMESTAMP NOT NULL,
    KEY transcript_entries_chat_id_seq_idx (chat_id, seq),
    KEY transcript_entries_user_id_idx (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS queued_messages (
    id VARCHAR(36) PRIMARY KEY,
    chat_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    queue_order INT NOT NULL,
    payload JSON NOT NULL,
    created_at TIMESTAMP NOT NULL,
    KEY queued_messages_chat_id_idx (chat_id, queue_order)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS user_settings (
    user_id VARCHAR(36) PRIMARY KEY,
    settings JSON NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS user_providers (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    provider ENUM('claude', 'llm') NOT NULL,
    config JSON NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY user_providers_user_provider_unique (user_id, provider)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS user_keybindings (
    user_id VARCHAR(36) PRIMARY KEY,
    bindings JSON NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS sidebar_orders (
    user_id VARCHAR(36) PRIMARY KEY,
    project_ids JSON NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS attachment_objects (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    project_id VARCHAR(36) NOT NULL,
    object_key TEXT NOT NULL,
    file_name VARCHAR(512) NOT NULL,
    mime_type VARCHAR(255) NULL,
    size_bytes INT NOT NULL,
    storage_backend ENUM('local', 'object_storage') NOT NULL DEFAULT 'object_storage',
    local_cache_path TEXT NULL,
    deleted_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY attachment_objects_user_project_idx (user_id, project_id),
    KEY attachment_objects_user_id_idx (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
]

const KANNA_TABLES = [
  "queued_messages",
  "transcript_entries",
  "chats",
  "projects",
  "sessions",
  "attachment_objects",
  "user_keybindings",
  "user_providers",
  "user_settings",
  "sidebar_orders",
  "users",
]

export async function resetKannaDatabase(databaseUrl: string) {
  const connection = await mysql.createConnection(databaseUrl)
  try {
    await connection.query("SET FOREIGN_KEY_CHECKS = 0")
    for (const table of KANNA_TABLES) {
      await connection.query(`DROP TABLE IF EXISTS \`${table}\``)
    }
    await connection.query("SET FOREIGN_KEY_CHECKS = 1")
  } finally {
    await connection.end()
  }

  await runMigrations(databaseUrl)
}

export async function truncateKannaDatabase(databaseUrl: string) {
  const connection = await mysql.createConnection(databaseUrl)
  try {
    await connection.query("SET FOREIGN_KEY_CHECKS = 0")
    for (const table of KANNA_TABLES) {
      await connection.query(`TRUNCATE TABLE \`${table}\``)
    }
    await connection.query("SET FOREIGN_KEY_CHECKS = 1")
  } finally {
    await connection.end()
  }
}

export async function runMigrations(databaseUrl: string) {
  const connection = await mysql.createConnection(databaseUrl)
  try {
    for (const statement of MIGRATION_STATEMENTS) {
      await connection.query(statement)
    }
  } finally {
    await connection.end()
  }
}
