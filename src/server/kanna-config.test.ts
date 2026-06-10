import { describe, expect, test } from "bun:test"
import { resolveTrustProxy } from "./kanna-config"

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
