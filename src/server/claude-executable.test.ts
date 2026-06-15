import { describe, expect, test } from "bun:test"
import { resolveClaudeCodeExecutable } from "./claude-executable"

describe("resolveClaudeCodeExecutable", () => {
  test("uses CLAUDE_EXECUTABLE when set", () => {
    expect(resolveClaudeCodeExecutable({ CLAUDE_EXECUTABLE: "/opt/claude/bin/claude" }))
      .toBe("/opt/claude/bin/claude")
  })

  test("expands ~ in CLAUDE_EXECUTABLE", () => {
    const resolved = resolveClaudeCodeExecutable({ CLAUDE_EXECUTABLE: "~/bin/claude" })
    expect(resolved?.endsWith("/bin/claude")).toBe(true)
    expect(resolved?.includes("~")).toBe(false)
  })

  test("prefers glibc linux binary before musl on linux", () => {
    if (process.platform !== "linux") return

    const resolved = resolveClaudeCodeExecutable({})
    expect(resolved).toBeTruthy()
    expect(resolved).toMatch(/claude-agent-sdk-linux-[^/]+\/claude$/)
    expect(resolved).not.toMatch(/-musl\/claude$/)
  })
})
