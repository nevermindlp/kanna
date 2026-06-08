import type {
  AgentProvider,
  ClaudeModelOptions,
  CodexModelOptions,
  ClaudeContextWindow,
  ModelOptions,
  ProviderCatalogEntry,
  ServiceTier,
} from "../shared/types"
import {
  DEFAULT_CLAUDE_MODEL_OPTIONS,
  DEFAULT_CODEX_MODEL_OPTIONS,
  normalizeClaudeContextWindow,
  normalizeProviderModelId,
  isClaudeReasoningEffort,
  isCodexReasoningEffort,
} from "../shared/types"
import { buildServerProviders, getCachedClaudeProviderSnapshot, isCustomClaudeModel } from "./claude-provider"

export const SERVER_PROVIDERS: ProviderCatalogEntry[] = buildServerProviders()

export function getServerProviderCatalog(
  provider: AgentProvider,
  providers: ProviderCatalogEntry[] = buildServerProviders(getCachedClaudeProviderSnapshot())
): ProviderCatalogEntry {
  const entry = providers.find((candidate) => candidate.id === provider)
  if (!entry) {
    throw new Error(`Unknown provider: ${provider}`)
  }
  return entry
}

export function normalizeServerModel(
  provider: AgentProvider,
  model?: string,
  providers: ProviderCatalogEntry[] = buildServerProviders(getCachedClaudeProviderSnapshot())
): string {
  const catalog = getServerProviderCatalog(provider, providers)
  const trimmedModel = typeof model === "string" ? model.trim() : ""
  if (provider === "claude" && trimmedModel && isCustomClaudeModel(trimmedModel)) {
    return trimmedModel
  }
  const normalizedModel = normalizeProviderModelId(provider, model, catalog.defaultModel)
  if (catalog.models.some((candidate) => candidate.id === normalizedModel)) {
    return normalizedModel
  }
  return catalog.defaultModel
}

export function normalizeClaudeModelOptions(
  model: string,
  modelOptions?: ModelOptions,
  legacyEffort?: string
): ClaudeModelOptions {
  const reasoningEffort = modelOptions?.claude?.reasoningEffort
  return {
    reasoningEffort: isClaudeReasoningEffort(reasoningEffort)
      ? reasoningEffort
      : isClaudeReasoningEffort(legacyEffort)
        ? legacyEffort
        : DEFAULT_CLAUDE_MODEL_OPTIONS.reasoningEffort,
    contextWindow: normalizeClaudeContextWindow(model, modelOptions?.claude?.contextWindow as ClaudeContextWindow | undefined),
  }
}

export function normalizeCodexModelOptions(modelOptions?: ModelOptions, legacyEffort?: string): CodexModelOptions {
  const reasoningEffort = modelOptions?.codex?.reasoningEffort
  return {
    reasoningEffort: isCodexReasoningEffort(reasoningEffort)
      ? reasoningEffort
      : isCodexReasoningEffort(legacyEffort)
        ? legacyEffort
        : DEFAULT_CODEX_MODEL_OPTIONS.reasoningEffort,
    fastMode: typeof modelOptions?.codex?.fastMode === "boolean"
      ? modelOptions.codex.fastMode
      : DEFAULT_CODEX_MODEL_OPTIONS.fastMode,
  }
}

export function codexServiceTierFromModelOptions(modelOptions: CodexModelOptions): ServiceTier | undefined {
  return modelOptions.fastMode ? "fast" : undefined
}
