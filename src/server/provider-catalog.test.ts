import { beforeEach, describe, expect, test } from "bun:test"
import { resetClaudeProviderCacheForTests, normalizeClaudeProviderSnapshot } from "./claude-provider"
import {
  codexServiceTierFromModelOptions,
  normalizeClaudeModelOptions,
  normalizeCodexModelOptions,
  normalizeServerModel,
  resolveClaudeAgentModelSettings,
} from "./provider-catalog"
import { resolveClaudeApiModelId } from "../shared/types"

describe("provider catalog normalization", () => {
  beforeEach(() => {
    resetClaudeProviderCacheForTests()
  })

  test("maps legacy Claude effort into shared model options", () => {
    expect(normalizeClaudeModelOptions("claude-opus-4-7", undefined, "max")).toEqual({
      reasoningEffort: "max",
      contextWindow: "200k",
    })
  })

  test("normalizes Claude context window only for supported models", () => {
    expect(normalizeClaudeModelOptions("claude-sonnet-4-6", {
      claude: {
        reasoningEffort: "medium",
        contextWindow: "1m",
      },
    })).toEqual({
      reasoningEffort: "medium",
      contextWindow: "1m",
    })

    expect(normalizeClaudeModelOptions("claude-haiku-4-5-20251001", {
      claude: {
        reasoningEffort: "medium",
        contextWindow: "1m",
      },
    })).toMatchObject({
      reasoningEffort: "medium",
    })
  })

  test("normalizes Codex model options and fast mode defaults", () => {
    expect(normalizeCodexModelOptions(undefined)).toEqual({
      reasoningEffort: "high",
      fastMode: false,
    })

    const normalized = normalizeCodexModelOptions({
      codex: {
        reasoningEffort: "xhigh",
        fastMode: true,
      },
    })

    expect(normalized).toEqual({
      reasoningEffort: "xhigh",
      fastMode: true,
    })
    expect(codexServiceTierFromModelOptions(normalized)).toBe("fast")
  })

  test("normalizes server model ids through the shared alias catalog", () => {
    expect(normalizeServerModel("codex")).toBe("gpt-5.5")
    expect(normalizeServerModel("claude", "opus")).toBe("claude-opus-4-7")
    expect(normalizeServerModel("codex", "gpt-5-codex")).toBe("gpt-5.3-codex")
  })

  test("resolves Claude API model ids for 1m context window", () => {
    expect(resolveClaudeApiModelId("claude-opus-4-7", "1m")).toBe("claude-opus-4-7[1m]")
    expect(resolveClaudeApiModelId("claude-sonnet-4-6", "200k")).toBe("claude-sonnet-4-6")
  })

  test("uses custom endpoint models instead of default Anthropic ids", () => {
    const provider = normalizeClaudeProviderSnapshot({
      apiKey: "test-key",
      baseUrl: "https://glm.example.com/anthropic",
      customModels: ["glm-5"],
      defaultModel: "glm-5",
    })

    expect(resolveClaudeAgentModelSettings({ model: "claude-sonnet-4-6" }, provider)).toEqual({
      model: "glm-5",
      effort: undefined,
      planMode: false,
    })
  })
})
