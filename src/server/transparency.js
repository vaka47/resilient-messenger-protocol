import crypto from "node:crypto";

import { stableStringify } from "../util.js";

export const TRANSPARENCY_PROFILE = "RMP-KEY-TRANSPARENCY-V1";

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function entryContent(entry) {
  const { entryHash, ...content } = entry;
  return content;
}

export function digestTransparencyPayload(payload) {
  return sha256Hex(Buffer.from(stableStringify(payload), "utf8"));
}

export function computeTransparencyEntryHash(entry) {
  return sha256Hex(Buffer.from(stableStringify(entryContent(entry)), "utf8"));
}

export function createTransparencyEntry({
  entries = [],
  type,
  accountId,
  deviceId,
  payload,
  createdAt = new Date().toISOString(),
}) {
  const previousHash = entries.at(-1)?.entryHash || null;
  const content = {
    profile: TRANSPARENCY_PROFILE,
    index: entries.length,
    type,
    accountId,
    deviceId,
    payloadDigest: digestTransparencyPayload(payload),
    previousHash,
    createdAt,
  };

  return {
    ...content,
    entryHash: computeTransparencyEntryHash(content),
  };
}

export function verifyTransparencyLog(entries = []) {
  let previousHash = null;

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];

    if (entry.profile !== TRANSPARENCY_PROFILE) {
      return {
        valid: false,
        error: `entry ${index} has unsupported profile`,
      };
    }

    if (entry.index !== index) {
      return {
        valid: false,
        error: `entry ${index} has wrong index`,
      };
    }

    if (entry.previousHash !== previousHash) {
      return {
        valid: false,
        error: `entry ${index} has wrong previous hash`,
      };
    }

    const expectedHash = computeTransparencyEntryHash(entry);

    if (entry.entryHash !== expectedHash) {
      return {
        valid: false,
        error: `entry ${index} hash mismatch`,
      };
    }

    previousHash = entry.entryHash;
  }

  return {
    valid: true,
    entryCount: entries.length,
    rootHash: previousHash,
  };
}

