import { describe, expect, test } from "bun:test"
import { resolveKannaRuntimeConfig, resolveS3ForcePathStyle, resolveTrustProxy } from "./kanna-config"

describe("resolveTrustProxy", () => {
  test("returns false when unset", () => {
    expect(resolveTrustProxy({})).toBe(false)
  })

  test("accepts common truthy values", () => {
    expect(resolveTrustProxy({ KANNA_TRUST_PROXY: "1" })).toBe(true)
    expect(resolveTrustProxy({ KANNA_TRUST_PROXY: "true" })).toBe(true)
    expect(resolveTrustProxy({ KANNA_TRUST_PROXY: "yes" })).toBe(true)
    expect(resolveTrustProxy({ KANNA_TRUST_PROXY: " TRUE " })).toBe(true)
  })

  test("rejects other values", () => {
    expect(resolveTrustProxy({ KANNA_TRUST_PROXY: "0" })).toBe(false)
    expect(resolveTrustProxy({ KANNA_TRUST_PROXY: "false" })).toBe(false)
    expect(resolveTrustProxy({ KANNA_TRUST_PROXY: "no" })).toBe(false)
  })
})

describe("resolveKannaRuntimeConfig S3", () => {
  test("parses Huawei Cloud OBS settings", () => {
    const config = resolveKannaRuntimeConfig({
      KANNA_AUTH_MODE: "multiuser",
      DATABASE_URL: "mysql://kanna:secret@127.0.0.1:3306/kanna",
      KANNA_S3_ENDPOINT: "https://obs.cn-north-4.myhuaweicloud.com",
      KANNA_S3_REGION: "cn-north-4",
      KANNA_S3_BUCKET: "kanna-attachments-prod",
      KANNA_S3_ACCESS_KEY_ID: "ak",
      KANNA_S3_SECRET_ACCESS_KEY: "sk",
    })

    expect(config.s3.endpoint).toBe("https://obs.cn-north-4.myhuaweicloud.com")
    expect(config.s3.region).toBe("cn-north-4")
    expect(config.s3.bucket).toBe("kanna-attachments-prod")
    expect(config.s3.forcePathStyle).toBeNull()
  })

  test("parses explicit forcePathStyle override", () => {
    const config = resolveKannaRuntimeConfig({
      KANNA_S3_ENDPOINT: "https://obs.cn-north-4.myhuaweicloud.com",
      KANNA_S3_FORCE_PATH_STYLE: "1",
    })

    expect(config.s3.forcePathStyle).toBe(true)
  })
})

describe("resolveS3ForcePathStyle", () => {
  test("uses virtual-host style for Huawei Cloud OBS by default", () => {
    expect(resolveS3ForcePathStyle({
      endpoint: "https://obs.cn-north-4.myhuaweicloud.com",
      region: "cn-north-4",
      bucket: "kanna-attachments-prod",
      accessKeyId: "ak",
      secretAccessKey: "sk",
      forcePathStyle: null,
    })).toBe(false)
  })

  test("uses path-style for local MinIO by default", () => {
    expect(resolveS3ForcePathStyle({
      endpoint: "http://127.0.0.1:9000",
      region: "us-east-1",
      bucket: "kanna",
      accessKeyId: "kanna",
      secretAccessKey: "secret",
      forcePathStyle: null,
    })).toBe(true)
  })

  test("honors explicit override", () => {
    expect(resolveS3ForcePathStyle({
      endpoint: "https://obs.cn-north-4.myhuaweicloud.com",
      region: "cn-north-4",
      bucket: "kanna",
      accessKeyId: "ak",
      secretAccessKey: "sk",
      forcePathStyle: true,
    })).toBe(true)
  })
})
