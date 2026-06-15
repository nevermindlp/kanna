import type {
  AgentProvider,
  ClaudeModelOptions,
  ClaudeProviderSnapshot,
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
  resolveClaudeApiModelId,
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

export function resolveClaudeAgentModelSettings(
  options: { model?: string; modelOptions?: ModelOptions; effort?: string; planMode?: boolean },
  claudeProvider: ClaudeProviderSnapshot | null = getCachedClaudeProviderSnapshot(),
) {
  const providers = buildServerProviders(claudeProvider)
  const catalog = getServerProviderCatalog("claude", providers)

  if (claudeProvider?.usesCustomEndpoint && claudeProvider.customModels.length > 0) {
    const trimmed = typeof options.model === "string" ? options.model.trim() : ""
    const model = trimmed && claudeProvider.customModels.includes(trimmed)
      ? trimmed
      : (claudeProvider.defaultModel || claudeProvider.customModels[0])
    return {
      model,
      effort: undefined as string | undefined,
      planMode: catalog.supportsPlanMode ? Boolean(options.planMode) : false,
    }
  }

  const model = normalizeServerModel("claude", options.model, providers)
  const isCustomModel = isCustomClaudeModel(model, claudeProvider)
  const modelOptions = normalizeClaudeModelOptions(model, options.modelOptions, options.effort)
  return {
    model: isCustomModel ? model : resolveClaudeApiModelId(model, modelOptions.contextWindow),
    effort: isCustomModel ? undefined : modelOptions.reasoningEffort,
    planMode: catalog.supportsPlanMode ? Boolean(options.planMode) : false,
  }
}
