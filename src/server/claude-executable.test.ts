import { homedir } from "node:os"
import { describe, expect, test } from "bun:test"
import { resolveClaudeCodeExecutable } from "./claude-executable"

describe("resolveClaudeCodeExecutable", () => {
  test("uses CLAUDE_EXECUTABLE when set to an executable file", () => {
    expect(resolveClaudeCodeExecutable({ CLAUDE_EXECUTABLE: "/bin/sh" }))
      .toBe("/bin/sh")
  })

  test("expands ~ in CLAUDE_EXECUTABLE when the target is executable", () => {
    const executable = process.execPath
    const home = homedir()
    if (!executable.startsWith(`${home}/`)) return

    const resolved = resolveClaudeCodeExecutable({
      CLAUDE_EXECUTABLE: `~${executable.slice(home.length)}`,
    })
    expect(resolved).toBe(executable)
  })

  test("falls back to bundled binary when CLAUDE_EXECUTABLE points to a missing file", () => {
    if (process.platform !== "linux") return

    const resolved = resolveClaudeCodeExecutable({
      CLAUDE_EXECUTABLE: "/app/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude",
    })
    expect(resolved).toBeTruthy()
    expect(resolved).toMatch(/claude-agent-sdk-linux-[^/]+\/claude$/)
    expect(resolved).not.toContain("linux-x64")
  })

  test("prefers glibc linux binary before musl on linux", () => {
    if (process.platform !== "linux") return

    const resolved = resolveClaudeCodeExecutable({})
    expect(resolved).toBeTruthy()
    expect(resolved).toMatch(/claude-agent-sdk-linux-[^/]+\/claude$/)
    expect(resolved).not.toMatch(/-musl\/claude$/)
  })
})
