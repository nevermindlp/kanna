import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import type { KannaDatabase } from "./db/client"
import { userKeybindings, userProviders, userSettings } from "./db/schema"
import { decryptJson, encryptJson } from "./auth-shared"
import { normalizeClaudeProviderSnapshot } from "./claude-provider"
import { normalizeLlmProviderSnapshot } from "./llm-provider"
import type {
  AppSettingsSnapshot,
  ClaudeProviderFile,
  ClaudeProviderSnapshot,
  KeybindingsSnapshot,
  LlmProviderSnapshot,
} from "../shared/types"

export class UserSettingsService {
  constructor(
    private readonly db: KannaDatabase,
    private readonly secretsKey: string | null,
  ) {}

  async readSettings(userId: string): Promise<AppSettingsSnapshot | null> {
    const rows = await this.db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1)
    return (rows[0]?.settings as AppSettingsSnapshot | undefined) ?? null
  }

  async writeSettings(userId: string, settings: AppSettingsSnapshot) {
    await this.db.insert(userSettings).values({
      userId,
      settings,
    }).onDuplicateKeyUpdate({
      set: { settings },
    })
  }

  async readKeybindings(userId: string): Promise<KeybindingsSnapshot | null> {
    const rows = await this.db.select().from(userKeybindings).where(eq(userKeybindings.userId, userId)).limit(1)
    return (rows[0]?.bindings as KeybindingsSnapshot | undefined) ?? null
  }

  async writeKeybindings(userId: string, bindings: KeybindingsSnapshot) {
    await this.db.insert(userKeybindings).values({
      userId,
      bindings,
    }).onDuplicateKeyUpdate({
      set: { bindings },
    })
  }

  async readProvider<T>(userId: string, provider: "claude" | "llm"): Promise<T | null> {
    const rows = await this.db
      .select()
      .from(userProviders)
      .where(eq(userProviders.userId, userId))
    const row = rows.find((entry) => entry.provider === provider)
    if (!row) return null
    const raw = typeof row.config === "string" ? row.config : JSON.stringify(row.config)
    return decryptJson<T>(raw, this.secretsKey)
  }

  async writeProvider<T>(userId: string, provider: "claude" | "llm", config: T) {
    const encrypted = encryptJson(config, this.secretsKey)
    const parsed = JSON.parse(encrypted)
    await this.db.insert(userProviders).values({
      id: randomUUID(),
      userId,
      provider,
      config: parsed,
    }).onDuplicateKeyUpdate({
      set: { config: parsed },
    })
  }
}

export function claudeSnapshotFromProviderConfig(
  config: ClaudeProviderFile | null,
  filePathDisplay: string,
): ClaudeProviderSnapshot {
  return normalizeClaudeProviderSnapshot(config ?? {}, filePathDisplay)
}

export function llmSnapshotFromProviderConfig(
  config: (Pick<LlmProviderSnapshot, "provider" | "apiKey" | "model" | "baseUrl">) | null,
  filePathDisplay: string,
): LlmProviderSnapshot {
  return normalizeLlmProviderSnapshot(config ?? {}, filePathDisplay)
}
