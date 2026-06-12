import { describe, expect, test } from "bun:test"
import {
  isOwnedObjectKey,
  OBJECT_STORAGE_ATTACHMENT_PREFIX,
  ObjectStorageService,
  parseObjectKeyFromContentUrl,
} from "./object-storage"
import { resolveKannaRuntimeConfig } from "./kanna-config"

describe("parseObjectKeyFromContentUrl", () => {
  test("extracts object key from attachment content URL", () => {
    const objectKey = "user-1/project-1/file.txt"
    expect(parseObjectKeyFromContentUrl(`${OBJECT_STORAGE_ATTACHMENT_PREFIX}${encodeURIComponent(objectKey)}`))
      .toBe(objectKey)
  })
})

describe("isOwnedObjectKey", () => {
  test("matches user prefix", () => {
    expect(isOwnedObjectKey("user-1/project-1/file.txt", "user-1")).toBe(true)
    expect(isOwnedObjectKey("user-2/project-1/file.txt", "user-1")).toBe(false)
  })
})

describe("ObjectStorageService", () => {
  test("is disabled without full S3 config", () => {
    const service = new ObjectStorageService(resolveKannaRuntimeConfig({}))
    expect(service.enabled).toBe(false)
  })

  test("is enabled with OBS-compatible config", () => {
    const service = new ObjectStorageService(resolveKannaRuntimeConfig({
      KANNA_S3_ENDPOINT: "https://obs.cn-north-4.myhuaweicloud.com",
      KANNA_S3_REGION: "cn-north-4",
      KANNA_S3_BUCKET: "kanna-attachments-prod",
      KANNA_S3_ACCESS_KEY_ID: "ak",
      KANNA_S3_SECRET_ACCESS_KEY: "sk",
    }))
    expect(service.enabled).toBe(true)
  })
})
