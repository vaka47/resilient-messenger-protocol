import crypto from "node:crypto";

import { stableStringify } from "../util.js";

export function computeDeviceFingerprint(accountId, deviceRecord) {
  if (!accountId || !deviceRecord?.deviceId) {
    throw new TypeError("accountId and deviceRecord.deviceId are required");
  }

  const digest = crypto
    .createHash("sha256")
    .update(
      stableStringify({
        accountId,
        deviceId: deviceRecord.deviceId,
        dhPublicKeyPem: deviceRecord.dhPublicKeyPem,
        signingPublicKeyPem: deviceRecord.signingPublicKeyPem,
      }),
    )
    .digest("hex")
    .toUpperCase();

  return digest.match(/.{1,4}/g).join(" ");
}

export function verifyDeviceFingerprint({
  state,
  accountId,
  deviceId,
  expectedFingerprint,
}) {
  const accountRecord = state.directoryCache?.[accountId];
  const deviceRecord = accountRecord?.devices?.[deviceId];

  if (!deviceRecord) {
    throw new Error(`Device ${deviceId} for account ${accountId} is not in the directory cache`);
  }

  const actualFingerprint = computeDeviceFingerprint(accountId, deviceRecord);

  if (actualFingerprint !== expectedFingerprint) {
    throw new Error("Device fingerprint mismatch");
  }

  return {
    ...state,
    verifiedDevices: {
      ...(state.verifiedDevices || {}),
      [`${accountId}:${deviceId}`]: {
        accountId,
        deviceId,
        fingerprint: actualFingerprint,
        verifiedAt: new Date().toISOString(),
      },
    },
  };
}

export function isDeviceVerified(state, accountId, deviceId) {
  return Boolean(state.verifiedDevices?.[`${accountId}:${deviceId}`]);
}
