import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  assertProjectDirectoryExists,
  isProjectDirectoryAccessible,
  resolveLocalPath,
} from "./paths"

describe("paths", () => {
  let tempDir = ""

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
      tempDir = ""
    }
  })

  test("resolveDefaultNewProjectRoot uses KANNA_PROJECT_ROOT when set", async () => {
    const { resolveDefaultNewProjectRoot } = await import("../shared/branding")
    expect(resolveDefaultNewProjectRoot({ KANNA_PROJECT_ROOT: "/projects" })).toBe("/projects")
    expect(resolveDefaultNewProjectRoot({})).toBe("~/Kanna")
  })

  test("isProjectDirectoryAccessible returns false for missing paths", () => {
    expect(isProjectDirectoryAccessible("/tmp/does-not-exist-kanna-test")).toBe(false)
  })

  test("isProjectDirectoryAccessible returns true for existing directories", async () => {
    tempDir = path.join(os.tmpdir(), `kanna-paths-test-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
    expect(isProjectDirectoryAccessible(tempDir)).toBe(true)
  })

  test("assertProjectDirectoryExists throws for missing directories", async () => {
    await expect(assertProjectDirectoryExists("/tmp/missing-kanna-project-dir")).rejects.toThrow(
      "Project directory does not exist",
    )
  })

  test("resolveLocalPath expands home-relative paths", () => {
    expect(resolveLocalPath("~/demo")).toBe(path.join(os.homedir(), "demo"))
  })
})
