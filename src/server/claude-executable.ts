import { accessSync, constants } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)

/**
 * Resolve the Claude Code CLI binary for the Agent SDK.
 *
 * On Linux the SDK prefers musl builds first, but glibc binaries are required on
 * Debian/glibc images (e.g. oven/bun). A musl binary can exist on disk yet fail
 * spawn with ENOENT, which the SDK reports as "native binary not found".
 */
export function resolveClaudeCodeExecutable(env: Record<string, string | undefined> = process.env): string | undefined {
  const override = env.CLAUDE_EXECUTABLE?.trim().replace(/^~(?=\/|$)/, homedir())
  if (override && isExecutableFile(override)) {
    return override
  }

  if (process.platform !== "linux") return undefined

  const arch = process.arch
  const packageNames = [
    `@anthropic-ai/claude-agent-sdk-linux-${arch}`,
    `@anthropic-ai/claude-agent-sdk-linux-${arch}-musl`,
  ]

  for (const packageName of packageNames) {
    const executable = resolveBundledClaudeBinary(packageName)
    if (executable) return executable
  }

  return undefined
}

function isExecutableFile(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function resolveBundledClaudeBinary(packageName: string): string | null {
  try {
    const packageJsonPath = require.resolve(`${packageName}/package.json`)
    const executable = path.join(path.dirname(packageJsonPath), "claude")
    accessSync(executable, constants.X_OK)
    return executable
  } catch {
    return null
  }
}
