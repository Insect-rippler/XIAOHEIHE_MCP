import { describe, expect, it } from "vitest";
import { normalizePath, signPath, workshopRnd } from "../src/signing/hkey.js";

/**
 * Expected values were derived from the live web client implementation in a separate
 * process, with wall clock and randomness pinned. They pin our re-implementation only;
 * no third-party source is linked into this project.
 */
const VECTORS = [
  { path: "/bbs/app/feeds", hkey: "U1V1I44", nonce: "D4DDFEAD7CBBD88223D35C5CF6D7C9AE" },
  { path: "/bbs/app/feeds", random: 0.987654321, hkey: "TX73I64", nonce: "C5BD9D31C3EC7D70403C218ED5003491" },
  { path: "/bbs/app/link/tree", hkey: "U1V1I44", nonce: "D4DDFEAD7CBBD88223D35C5CF6D7C9AE" },
  { path: "/bbs/app/user/message", hkey: "U1V1I44", nonce: "D4DDFEAD7CBBD88223D35C5CF6D7C9AE" },
  { path: "/bbs/app/comment/create", hkey: "U1V1I44", nonce: "D4DDFEAD7CBBD88223D35C5CF6D7C9AE" },
  // Path normalization: duplicate and trailing slashes collapse to the same signature.
  { path: "//bbs//app//feeds//", hkey: "U1V1I44", nonce: "D4DDFEAD7CBBD88223D35C5CF6D7C9AE" },
  { path: "/bbs/app", hkey: "U1V1I44", nonce: "D4DDFEAD7CBBD88223D35C5CF6D7C9AE" },
  // A path that differs inside the first seven characters produces a different hkey.
  { path: "/api/x", hkey: "7VWPI35", nonce: "D4DDFEAD7CBBD88223D35C5CF6D7C9AE" },
];

const TIME_MS = 1_750_000_000 * 1000;

describe("signPath", () => {
  for (const vector of VECTORS) {
    it(`matches the pinned signature for ${vector.path}`, () => {
      const signed = signPath(vector.path, {
        nowMs: TIME_MS,
        random: vector.random ?? 0.123456789,
      });
      expect(signed.hkey).toBe(vector.hkey);
      expect(signed.nonce).toBe(vector.nonce);
      expect(signed._time).toBe(1_750_000_000);
    });
  }

  it("accepts an explicit nonce", () => {
    const signed = signPath("/bbs/app/feeds", { nowMs: TIME_MS, nonce: "ABC" });
    expect(signed.nonce).toBe("ABC");
  });

  it("does not depend on the sub-second clock", () => {
    const a = signPath("/bbs/app/feeds", { nowMs: TIME_MS, random: 0.5 });
    const b = signPath("/bbs/app/feeds", { nowMs: TIME_MS + 999, random: 0.5 });
    expect(a).toEqual(b);
  });
});

describe("normalizePath", () => {
  it("produces a leading and trailing slash", () => {
    expect(normalizePath("bbs/app/feeds")).toBe("/bbs/app/feeds/");
    expect(normalizePath("//bbs//app//feeds//")).toBe("/bbs/app/feeds/");
  });
});

describe("workshopRnd", () => {
  it("returns the pinned HMAC for a known nonce", () => {
    expect(workshopRnd({ nonce: "D4DDFEAD7CBBD88223D35C5CF6D7C9AE", _time: 1_750_000_000 })).toBe(
      "15:1c70209a88c32d9831b1474d6cca56f8d8aec9082d21a558a6aa23cfb96253ad",
    );
  });

  it("is deterministic for the same inputs and changes with the nonce", () => {
    const base = { nonce: "AAAA", _time: 1_750_000_000 };
    expect(workshopRnd(base)).toBe(workshopRnd(base));
    expect(workshopRnd(base)).not.toBe(workshopRnd({ ...base, nonce: "BBBB" }));
  });
});
