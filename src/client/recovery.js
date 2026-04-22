import crypto from "node:crypto";

import { stableStringify } from "../util.js";

export const RECOVERY_PROFILE = "RMP-ENCRYPTED-RECOVERY-V1";

const KDF = {
  name: "scrypt",
  keyLength: 32,
  N: 2 ** 14,
  r: 8,
  p: 1,
};

function deriveRecoveryKey(passphrase, salt) {
  if (typeof passphrase !== "string" || passphrase.length < 12) {
    throw new Error("Recovery passphrase must be at least 12 characters");
  }

  return crypto.scryptSync(passphrase, salt, KDF.keyLength, {
    N: KDF.N,
    r: KDF.r,
    p: KDF.p,
    maxmem: 64 * 1024 * 1024,
  });
}

function recoveryMetadata({ accountId, deviceId, createdAt, saltB64, ivB64 }) {
  return {
    profile: RECOVERY_PROFILE,
    version: 1,
    accountId,
    deviceId,
    kdf: KDF,
    cipher: "AES-256-GCM",
    saltB64,
    ivB64,
    createdAt,
  };
}

function recoverableStateSnapshot(state) {
  return {
    version: state.version,
    account: state.account,
    device: state.device,
    directoryCache: state.directoryCache || {},
    verifiedDevices: state.verifiedDevices || {},
  };
}

export function createRecoveryBundle({
  state,
  passphrase,
  createdAt = new Date().toISOString(),
}) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveRecoveryKey(passphrase, salt);
  const metadata = recoveryMetadata({
    accountId: state.account.accountId,
    deviceId: state.device.deviceId,
    createdAt,
    saltB64: salt.toString("base64"),
    ivB64: iv.toString("base64"),
  });
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const aad = Buffer.from(stableStringify(metadata), "utf8");
  cipher.setAAD(aad);

  const plaintext = Buffer.from(
    stableStringify({
      state: recoverableStateSnapshot(state),
    }),
    "utf8",
  );
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return {
    ...metadata,
    ciphertextB64: ciphertext.toString("base64"),
    tagB64: cipher.getAuthTag().toString("base64"),
  };
}

export function openRecoveryBundle({ bundle, passphrase }) {
  const parsed = typeof bundle === "string" ? JSON.parse(bundle) : bundle;

  if (parsed.profile !== RECOVERY_PROFILE || parsed.version !== 1) {
    throw new Error("Unsupported recovery bundle profile");
  }

  const metadata = recoveryMetadata({
    accountId: parsed.accountId,
    deviceId: parsed.deviceId,
    createdAt: parsed.createdAt,
    saltB64: parsed.saltB64,
    ivB64: parsed.ivB64,
  });
  const key = deriveRecoveryKey(passphrase, Buffer.from(parsed.saltB64, "base64"));
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(parsed.ivB64, "base64"),
  );
  decipher.setAAD(Buffer.from(stableStringify(metadata), "utf8"));
  decipher.setAuthTag(Buffer.from(parsed.tagB64, "base64"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(parsed.ciphertextB64, "base64")),
    decipher.final(),
  ]);
  const decoded = JSON.parse(plaintext.toString("utf8"));

  return decoded.state;
}

