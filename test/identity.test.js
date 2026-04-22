import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  computeDeviceFingerprint,
  isDeviceVerified,
  verifyDeviceFingerprint,
} from "../src/client/identity.js";

function exportPem(keyObject, type) {
  return keyObject.export({ format: "pem", type }).toString();
}

function createDeviceRecord(deviceId) {
  const { publicKey: dhPublicKey } = crypto.generateKeyPairSync("x25519");
  const { publicKey: signingPublicKey } = crypto.generateKeyPairSync("ed25519");

  return {
    deviceId,
    inboxId: `${deviceId}-inbox`,
    dhPublicKeyPem: exportPem(dhPublicKey, "spki"),
    signingPublicKeyPem: exportPem(signingPublicKey, "spki"),
  };
}

test("device fingerprints are stable and can be verified into local state", () => {
  const device = createDeviceRecord("device-1");
  const fingerprint = computeDeviceFingerprint("account-1", device);
  const state = {
    directoryCache: {
      "account-1": {
        accountId: "account-1",
        devices: {
          "device-1": device,
        },
      },
    },
  };

  const verifiedState = verifyDeviceFingerprint({
    state,
    accountId: "account-1",
    deviceId: "device-1",
    expectedFingerprint: fingerprint,
  });

  assert.equal(isDeviceVerified(verifiedState, "account-1", "device-1"), true);
});

test("device verification rejects fingerprint mismatch", () => {
  const device = createDeviceRecord("device-1");
  const state = {
    directoryCache: {
      "account-1": {
        accountId: "account-1",
        devices: {
          "device-1": device,
        },
      },
    },
  };

  assert.throws(() => {
    verifyDeviceFingerprint({
      state,
      accountId: "account-1",
      deviceId: "device-1",
      expectedFingerprint: "0000",
    });
  }, /fingerprint mismatch/);
});
