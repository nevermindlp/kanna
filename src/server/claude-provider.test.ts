import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import {
  buildClaudeSessionEnv,
  buildServerProviders,
  normalizeClaudeProviderBaseUrl,
  normalizeClaudeProviderSnapshot,
  readClaudeProviderSnapshot,
  resetClaudeProviderCacheForTests,
  writeClaudeProviderSnapshot,
} from "./claude-provider"

const TEST_FILE_PATH = "/tmp/kanna-test-claude-provider.json"

afterEach(() => {
  resetClaudeProviderCacheForTests()
})

async function createTempFilePath() {
  const dir = await mkdtemp(path.join(tmpdir(), "kanna-claude-provider-"))
  return {
    filePath: path.join(dir, "claude-provider.json"),
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true })
    },
  }
}

describe("normalizeClaudeProviderSnapshot", () => {
  test("normalizes custom endpoint configuration", () => {
    expect(normalizeClaudeProviderSnapshot({
      apiKey: " test-key ",
      baseUrl: " https://example.com/v1 ",
      customModels: [" glm-4-plus ", "glm-4-flash", "glm-4-plus"],
      defaultModel: "glm-4-plus",
    }, TEST_FILE_PATH)).toEqual({
      apiKey: "test-key",
      baseUrl: "https://example.com/v1",
      customModels: ["glm-4-plus", "glm-4-flash"],
      defaultModel: "glm-4-plus",
      enabled: true,
      usesCustomEndpoint: true,
      warning: null,
      filePathDisplay: TEST_FILE_PATH,
    })
  })

  test("requires custom models when a custom endpoint is configured", () => {
    const snapshot = normalizeClaudeProviderSnapshot({
      apiKey: "test-key",
      baseUrl: "https://example.com/v1",
      customModels: [],
    }, TEST_FILE_PATH)

    expect(snapshot.enabled).toBe(false)
    expect(snapshot.warning).toContain("custom endpoint requires at least one custom model id")
  })
})

describe("buildServerProviders", () => {
  test("replaces Claude models when a custom endpoint is configured", () => {
    const providers = buildServerProviders(normalizeClaudeProviderSnapshot({
      apiKey: "test-key",
      baseUrl: "https://example.com/v1",
      customModels: ["glm-4-plus"],
      defaultModel: "glm-4-plus",
    }))

    const claude = providers.find((provider) => provider.id === "claude")
    expect(claude?.defaultModel).toBe("glm-4-plus")
    expect(claude?.models.map((model) => model.id)).toEqual(["glm-4-plus"])
  })
})

describe("normalizeClaudeProviderBaseUrl", () => {
  test("strips anthropic message suffixes from pasted endpoint urls", () => {
    expect(normalizeClaudeProviderBaseUrl("https://example.com/anthropic/v1/messages")).toBe("https://example.com/anthropic")
    expect(normalizeClaudeProviderBaseUrl("https://example.com/anthropic/messages/")).toBe("https://example.com/anthropic")
  })
})

describe("buildClaudeSessionEnv", () => {
  test("injects Anthropic credentials and removes CLAUDECODE", async () => {
    const { filePath, cleanup } = await createTempFilePath()

    try {
      await writeClaudeProviderSnapshot({
        apiKey: "test-key",
        baseUrl: "https://example.com/v1",
        customModels: ["glm-4-plus"],
        defaultModel: "glm-4-plus",
      }, filePath)

      const env = buildClaudeSessionEnv({
        CLAUDECODE: "1",
        PATH: "/usr/bin",
      })

      expect(env.CLAUDECODE).toBeUndefined()
      expect(env.PATH).toBe("/usr/bin")
      expect(env.ANTHROPIC_API_KEY).toBe("test-key")
      expect(env.ANTHROPIC_AUTH_TOKEN).toBe("test-key")
      expect(env.ANTHROPIC_BASE_URL).toBe("https://example.com/v1")
    } finally {
      await cleanup()
    }
  })
})

describe("writeClaudeProviderSnapshot", () => {
  test("persists provider settings to disk", async () => {
    const { filePath, cleanup } = await createTempFilePath()

    try {
      const snapshot = await writeClaudeProviderSnapshot({
        apiKey: " test-key ",
        baseUrl: "https://example.com/v1",
        customModels: ["glm-4-plus"],
        defaultModel: "glm-4-plus",
      }, filePath)

      expect(snapshot.apiKey).toBe("test-key")
      expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual({
        apiKey: "test-key",
        baseUrl: "https://example.com/v1",
        customModels: ["glm-4-plus"],
        defaultModel: "glm-4-plus",
      })
      expect(await readClaudeProviderSnapshot(filePath)).toEqual(snapshot)
    } finally {
      await cleanup()
    }
  })
})
