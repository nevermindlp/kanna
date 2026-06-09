import type { AppSettingsManager } from "./app-settings"
import { validateClaudeProviderCredentials } from "./claude-provider"
import type { KeybindingsManager } from "./keybindings"
import { normalizeKeybindings } from "./keybindings"
import { validateLlmProviderCredentials } from "./llm-provider"
import type {
  AppSettingsPatch,
  AppSettingsSnapshot,
  ClaudeProviderSnapshot,
  ClaudeProviderValidationResult,
  KeybindingAction,
  KeybindingsSnapshot,
  LlmProviderSnapshot,
  LlmProviderValidationResult,
} from "../shared/types"
import {
  UserSettingsService,
  claudeSnapshotFromProviderConfig,
  llmSnapshotFromProviderConfig,
} from "./user-settings-service"

const ACCOUNT_SETTINGS_LABEL = "account settings"

function mergeAppSettingsPatch(snapshot: AppSettingsSnapshot, patch: AppSettingsPatch): AppSettingsSnapshot {
  return {
    ...snapshot,
    ...patch,
    terminal: {
      ...snapshot.terminal,
      ...patch.terminal,
    },
    editor: {
      ...snapshot.editor,
      ...patch.editor,
    },
    providerDefaults: {
      claude: {
        ...snapshot.providerDefaults.claude,
        ...patch.providerDefaults?.claude,
        modelOptions: {
          ...snapshot.providerDefaults.claude.modelOptions,
          ...patch.providerDefaults?.claude?.modelOptions,
        },
      },
      codex: {
        ...snapshot.providerDefaults.codex,
        ...patch.providerDefaults?.codex,
        modelOptions: {
          ...snapshot.providerDefaults.codex.modelOptions,
          ...patch.providerDefaults?.codex?.modelOptions,
        },
      },
    },
  }
}

export interface UserScopedSettingsAdapters {
  appSettings: {
    getSnapshot: () => AppSettingsSnapshot | Promise<AppSettingsSnapshot>
    write: (value: { analyticsEnabled: boolean }) => Promise<AppSettingsSnapshot>
    writePatch: (patch: AppSettingsPatch) => Promise<AppSettingsSnapshot>
  }
  keybindings: {
    getSnapshot: () => KeybindingsSnapshot | Promise<KeybindingsSnapshot>
    write: (bindings: Partial<Record<KeybindingAction, string[]>>) => Promise<KeybindingsSnapshot>
  }
  claudeProvider: {
    read: () => Promise<ClaudeProviderSnapshot>
    write: (value: Pick<ClaudeProviderSnapshot, "apiKey" | "baseUrl" | "customModels" | "defaultModel">) => Promise<ClaudeProviderSnapshot>
    validate: (value: Pick<ClaudeProviderSnapshot, "apiKey" | "baseUrl" | "customModels" | "defaultModel">) => Promise<ClaudeProviderValidationResult>
  }
  llmProvider: {
    read: () => Promise<LlmProviderSnapshot>
    write: (value: Pick<LlmProviderSnapshot, "provider" | "apiKey" | "model" | "baseUrl">) => Promise<LlmProviderSnapshot>
    validate: (value: Pick<LlmProviderSnapshot, "provider" | "apiKey" | "model" | "baseUrl">) => Promise<LlmProviderValidationResult>
  }
}

export function createUserScopedSettingsAdapters(args: {
  userId: string
  isMultiTenant: boolean
  userSettingsService: UserSettingsService | null
  keybindings: KeybindingsManager
  appSettings?: Pick<AppSettingsManager, "getSnapshot" | "write"> & Partial<Pick<AppSettingsManager, "writePatch">>
  fallbackAppSettings: AppSettingsSnapshot
  fileClaudeProvider: UserScopedSettingsAdapters["claudeProvider"]
  fileLlmProvider: UserScopedSettingsAdapters["llmProvider"]
}): UserScopedSettingsAdapters {
  if (!args.userSettingsService || !args.isMultiTenant) {
    return {
      appSettings: {
        getSnapshot: () => args.appSettings?.getSnapshot() ?? args.fallbackAppSettings,
        write: async (value) => args.appSettings?.write(value) ?? { ...args.fallbackAppSettings, analyticsEnabled: value.analyticsEnabled },
        writePatch: async (patch) => args.appSettings?.writePatch?.(patch) ?? mergeAppSettingsPatch(args.fallbackAppSettings, patch),
      },
      keybindings: {
        getSnapshot: () => args.keybindings.getSnapshot(),
        write: (bindings) => args.keybindings.write(bindings),
      },
      claudeProvider: args.fileClaudeProvider,
      llmProvider: args.fileLlmProvider,
    }
  }

  const service = args.userSettingsService
  const userId = args.userId

  async function readAppSettingsSnapshot() {
    const stored = await service.readSettings(userId)
    return stored ?? args.appSettings?.getSnapshot() ?? args.fallbackAppSettings
  }

  async function writeAppSettingsSnapshot(next: AppSettingsSnapshot) {
    await service.writeSettings(userId, next)
    return next
  }

  return {
    appSettings: {
      getSnapshot: readAppSettingsSnapshot,
      write: async (value) => {
        const current = await readAppSettingsSnapshot()
        return writeAppSettingsSnapshot({ ...current, analyticsEnabled: value.analyticsEnabled })
      },
      writePatch: async (patch) => {
        const current = await readAppSettingsSnapshot()
        return writeAppSettingsSnapshot(mergeAppSettingsPatch(current, patch))
      },
    },
    keybindings: {
      getSnapshot: async () => {
        const stored = await service.readKeybindings(userId)
        return stored ?? args.keybindings.getSnapshot()
      },
      write: async (bindings) => {
        const snapshot = normalizeKeybindings(bindings, ACCOUNT_SETTINGS_LABEL)
        await service.writeKeybindings(userId, snapshot)
        return snapshot
      },
    },
    claudeProvider: {
      read: async () => {
        const config = await service.readProvider<{
          apiKey?: string
          baseUrl?: string | null
          customModels?: string[]
          defaultModel?: string
        }>(userId, "claude")
        return claudeSnapshotFromProviderConfig(config, ACCOUNT_SETTINGS_LABEL)
      },
      write: async (value) => {
        const snapshot = claudeSnapshotFromProviderConfig(value, ACCOUNT_SETTINGS_LABEL)
        await service.writeProvider(userId, "claude", {
          apiKey: snapshot.apiKey,
          baseUrl: snapshot.baseUrl || null,
          customModels: snapshot.customModels,
          defaultModel: snapshot.defaultModel || undefined,
        })
        return snapshot
      },
      validate: (value) => validateClaudeProviderCredentials(value),
    },
    llmProvider: {
      read: async () => {
        const config = await service.readProvider<{
          provider?: LlmProviderSnapshot["provider"]
          apiKey?: string
          model?: string
          baseUrl?: string | null
        }>(userId, "llm")
        return llmSnapshotFromProviderConfig(config ? {
          provider: config.provider ?? "openai",
          apiKey: config.apiKey ?? "",
          model: config.model ?? "",
          baseUrl: config.baseUrl ?? "",
        } : null, ACCOUNT_SETTINGS_LABEL)
      },
      write: async (value) => {
        const snapshot = llmSnapshotFromProviderConfig(value, ACCOUNT_SETTINGS_LABEL)
        await service.writeProvider(userId, "llm", {
          provider: snapshot.provider,
          apiKey: snapshot.apiKey,
          model: snapshot.model,
          baseUrl: snapshot.provider === "custom" ? snapshot.baseUrl : null,
        })
        return snapshot
      },
      validate: (value) => validateLlmProviderCredentials(value),
    },
  }
}
