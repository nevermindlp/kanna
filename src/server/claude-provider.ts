import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { getClaudeProviderFilePath } from "../shared/branding"
import type {
  ClaudeProviderFile,
  ClaudeProviderSnapshot,
  ClaudeProviderValidationResult,
  ProviderCatalogEntry,
  ProviderModelOption,
} from "../shared/types"
import { PROVIDERS } from "../shared/types"

function formatDisplayPath(filePath: string) {
  const homePath = homedir()
  if (filePath === homePath) return "~"
  if (filePath.startsWith(`${homePath}${path.sep}`)) {
    return `~${filePath.slice(homePath.length)}`
  }
  return filePath
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function normalizeCustomModels(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(
    value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean)
  )]
}

export function normalizeClaudeProviderBaseUrl(baseUrl: string) {
  return baseUrl
    .trim()
    .replace(/\/+$/u, "")
    .replace(/\/v1\/messages$/u, "")
    .replace(/\/messages$/u, "")
}

function customModelOptions(modelIds: string[]): ProviderModelOption[] {
  return modelIds.map((id) => ({
    id,
    label: id,
    supportsEffort: false,
  }))
}

let cachedSnapshot: ClaudeProviderSnapshot | null = null

export function resetClaudeProviderCacheForTests() {
  cachedSnapshot = null
}

export function getCachedClaudeProviderSnapshot() {
  return cachedSnapshot
}

export function normalizeClaudeProviderSnapshot(
  value: unknown,
  filePath = getClaudeProviderFilePath(homedir())
): ClaudeProviderSnapshot {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
  const warnings: string[] = []

  if (!source) {
    return createDefaultSnapshot(
      filePath,
      value === undefined || value === null ? null : "Claude provider file must contain a JSON object. Using defaults."
    )
  }

  const apiKey = normalizeString(source.apiKey)
  const baseUrl = normalizeClaudeProviderBaseUrl(normalizeString(source.baseUrl))
  const customModels = normalizeCustomModels(source.customModels)
  const defaultModel = normalizeString(source.defaultModel)

  if (source.apiKey !== undefined && typeof source.apiKey !== "string") {
    warnings.push("apiKey must be a string")
  }
  if (source.baseUrl !== undefined && source.baseUrl !== null && typeof source.baseUrl !== "string") {
    warnings.push("baseUrl must be a string or null")
  }
  if (source.customModels !== undefined && !Array.isArray(source.customModels)) {
    warnings.push("customModels must be an array of strings")
  }
  if (source.defaultModel !== undefined && typeof source.defaultModel !== "string") {
    warnings.push("defaultModel must be a string")
  }
  if (baseUrl && customModels.length === 0) {
    warnings.push("custom endpoint requires at least one custom model id")
  }
  if (defaultModel && customModels.length > 0 && !customModels.includes(defaultModel)) {
    warnings.push("defaultModel must be one of the configured customModels")
  }

  const usesCustomEndpoint = baseUrl.length > 0
  const resolvedDefaultModel = defaultModel
    || (customModels[0] ?? "")
  const enabled = warnings.length === 0 && apiKey.length > 0 && (
    !usesCustomEndpoint || (customModels.length > 0 && resolvedDefaultModel.length > 0)
  )

  return {
    apiKey,
    baseUrl,
    customModels,
    defaultModel: resolvedDefaultModel,
    enabled,
    usesCustomEndpoint,
    warning: warnings.length > 0 ? `Some Claude provider settings are invalid: ${warnings.join("; ")}` : null,
    filePathDisplay: formatDisplayPath(filePath),
  }
}

function createDefaultSnapshot(filePath: string, warning: string | null = null): ClaudeProviderSnapshot {
  return {
    apiKey: "",
    baseUrl: "",
    customModels: [],
    defaultModel: "",
    enabled: false,
    usesCustomEndpoint: false,
    warning,
    filePathDisplay: formatDisplayPath(filePath),
  }
}

export async function readClaudeProviderSnapshot(filePath = getClaudeProviderFilePath(homedir())) {
  try {
    const text = await readFile(filePath, "utf8")
    if (!text.trim()) {
      cachedSnapshot = createDefaultSnapshot(filePath, "Claude provider file was empty. Using defaults.")
      return cachedSnapshot
    }
    cachedSnapshot = normalizeClaudeProviderSnapshot(JSON.parse(text), filePath)
    return cachedSnapshot
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      cachedSnapshot = createDefaultSnapshot(filePath)
      return cachedSnapshot
    }
    if (error instanceof SyntaxError) {
      cachedSnapshot = createDefaultSnapshot(filePath, "Claude provider file is invalid JSON. Using defaults.")
      return cachedSnapshot
    }
    throw error
  }
}

export async function writeClaudeProviderSnapshot(
  value: Pick<ClaudeProviderFile, "apiKey" | "baseUrl" | "customModels" | "defaultModel">,
  filePath = getClaudeProviderFilePath(homedir())
) {
  const snapshot = normalizeClaudeProviderSnapshot(value, filePath)
  const payload: ClaudeProviderFile = {
    apiKey: snapshot.apiKey,
    baseUrl: snapshot.baseUrl || null,
    customModels: snapshot.customModels,
    defaultModel: snapshot.defaultModel || undefined,
  }
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
  cachedSnapshot = snapshot
  return snapshot
}

export function buildClaudeSessionEnvFromSnapshot(
  snapshot: ClaudeProviderSnapshot | null,
  baseEnv: Record<string, string | undefined> = process.env,
) {
  const env = { ...baseEnv }
  delete env.CLAUDECODE

  if (snapshot?.apiKey) {
    env.ANTHROPIC_API_KEY = snapshot.apiKey
    env.ANTHROPIC_AUTH_TOKEN = snapshot.apiKey
  }
  if (snapshot?.baseUrl) {
    env.ANTHROPIC_BASE_URL = normalizeClaudeProviderBaseUrl(snapshot.baseUrl)
  }

  return env
}

export function buildClaudeSessionEnv(baseEnv: Record<string, string | undefined> = process.env) {
  return buildClaudeSessionEnvFromSnapshot(cachedSnapshot, baseEnv)
}

export function buildServerProviders(claudeProvider: ClaudeProviderSnapshot | null = cachedSnapshot): ProviderCatalogEntry[] {
  const codexCatalog = PROVIDERS.find((provider) => provider.id === "codex")
  const hardCodedCodexModels: ProviderModelOption[] = [
    { id: "gpt-5.5", label: "GPT-5.5", supportsEffort: false },
    { id: "gpt-5.4", label: "GPT-5.4", supportsEffort: false },
    { id: "gpt-5.3-codex", label: "GPT-5.3 Codex", supportsEffort: false },
    { id: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark", supportsEffort: false },
  ]

  const withCodexOverrides = (providers: ProviderCatalogEntry[]) =>
    providers.map((provider) =>
      provider.id === "codex" && codexCatalog
        ? {
            ...codexCatalog,
            defaultModel: "gpt-5.5",
            models: hardCodedCodexModels,
          }
        : provider
    )

  const claudeCatalog = PROVIDERS.find((provider) => provider.id === "claude")
  if (!claudeCatalog) return withCodexOverrides([...PROVIDERS])

  const customModels = claudeProvider?.usesCustomEndpoint ? claudeProvider.customModels : []
  if (customModels.length === 0) {
    return withCodexOverrides([...PROVIDERS])
  }

  const models = customModelOptions(customModels)
  const defaultModel = claudeProvider?.defaultModel && customModels.includes(claudeProvider.defaultModel)
    ? claudeProvider.defaultModel
    : customModels[0]

  return withCodexOverrides(PROVIDERS.map((provider) => {
    if (provider.id !== "claude") return provider
    return {
      ...provider,
      defaultModel,
      models,
      efforts: [],
    }
  }))
}

export function isCustomClaudeModel(modelId: string, claudeProvider: ClaudeProviderSnapshot | null = cachedSnapshot) {
  if (!claudeProvider?.usesCustomEndpoint) return false
  return claudeProvider.customModels.includes(modelId.trim())
}

function formatApiErrorMessage(body: string) {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>
    if (typeof parsed.error_msg === "string" && parsed.error_msg.trim()) {
      return parsed.error_msg
    }
    const nestedError = parsed.error
    if (nestedError && typeof nestedError === "object" && typeof (nestedError as { message?: unknown }).message === "string") {
      return (nestedError as { message: string }).message
    }
  } catch {
    // Fall back to raw response text.
  }
  return body
}

export async function validateClaudeProviderCredentials(
  value: Pick<ClaudeProviderSnapshot, "apiKey" | "baseUrl" | "customModels" | "defaultModel">
): Promise<ClaudeProviderValidationResult> {
  const snapshot = normalizeClaudeProviderSnapshot(value)
  if (!snapshot.enabled) {
    return {
      ok: false,
      error: {
        type: "config_error",
        message: snapshot.warning ?? "Claude provider configuration is incomplete.",
      },
    }
  }

  if (!snapshot.usesCustomEndpoint) {
    return { ok: true, error: null }
  }

  const model = snapshot.defaultModel || snapshot.customModels[0]
  const baseUrl = normalizeClaudeProviderBaseUrl(snapshot.baseUrl)

  try {
    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": snapshot.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 8,
        messages: [{ role: "user", content: "Reply with ok." }],
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      return {
        ok: false,
        error: {
          type: "api_error",
          status: response.status,
          message: formatApiErrorMessage(body) || `Request failed with status ${response.status}`,
        },
      }
    }

    return { ok: true, error: null }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error
        ? { type: "network_error", message: error.message }
        : { type: "network_error", message: String(error) },
    }
  }
}
