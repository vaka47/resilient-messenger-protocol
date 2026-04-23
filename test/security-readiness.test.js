import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createRecoveryBundle, openRecoveryBundle } from "../src/client/recovery.js";
import { initLocalState, linkLocalDevice } from "../src/client/state.js";
import { bootstrapStateWithApi, registerStateWithApi } from "../src/client/workflow.js";
import { createDirectApi } from "../src/server/direct-api.js";
import { FileBackedStateStore } from "../src/server/state-store.js";
import { verifyTransparencyLog } from "../src/server/transparency.js";

test("key transparency records device lifecycle in a verifiable hash chain", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rmp-transparency-"));
  const store = new FileBackedStateStore(path.join(tmpRoot, "server-state.json"));
  await store.init();
  const api = createDirectApi(store);

  let alicePhone = await initLocalState({
    stateDir: path.join(tmpRoot, "alice-phone"),
    displayName: "Alice",
  });
  let aliceLaptop = await linkLocalDevice({
    sourceStateDir: path.join(tmpRoot, "alice-phone"),
    targetStateDir: path.join(tmpRoot, "alice-laptop"),
  });

  alicePhone = await bootstrapStateWithApi({
    baseUrl: "memory://protocol",
    state: alicePhone,
    api,
    phone: "+10000000101",
    password: "alice-password-123",
    passwordConfirm: "alice-password-123",
  });
  aliceLaptop = await registerStateWithApi({
    baseUrl: "memory://protocol",
    state: aliceLaptop,
    api,
    password: "alice-password-123",
  });

  let transparency = await api.fetchTransparencyLog();
  assert.equal(transparency.verification.valid, true);
  assert.equal(transparency.entries.length, 2);
  assert.equal(transparency.entries[0].type, "account.bootstrap");
  assert.equal(transparency.entries[1].previousHash, transparency.entries[0].entryHash);

  await api.revokeDevice(
    "memory://protocol",
    alicePhone.account.accountId,
    aliceLaptop.device.deviceId,
    alicePhone.device.deviceId,
  );

  transparency = await api.fetchTransparencyLog();
  assert.equal(transparency.verification.valid, true);
  assert.equal(transparency.entries.length, 3);
  assert.equal(transparency.entries[2].type, "device.revoked");

  const tampered = transparency.entries.map((entry) => ({ ...entry }));
  tampered[1].payloadDigest = "00";
  assert.equal(verifyTransparencyLog(tampered).valid, false);
});

test("recovery bundle encrypts local key material and rejects wrong passphrases", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rmp-recovery-"));
  const state = await initLocalState({
    stateDir: path.join(tmpRoot, "alice"),
    displayName: "Alice",
  });
  const bundle = createRecoveryBundle({
    state,
    passphrase: "correct horse battery staple",
  });
  const serialized = JSON.stringify(bundle);

  assert.equal(serialized.includes(state.device.dhPrivateKeyPem), false);
  assert.equal(serialized.includes(state.device.signingPrivateKeyPem), false);

  const recovered = openRecoveryBundle({
    bundle,
    passphrase: "correct horse battery staple",
  });

  assert.equal(recovered.account.accountId, state.account.accountId);
  assert.equal(recovered.device.deviceId, state.device.deviceId);
  assert.equal(recovered.device.dhPrivateKeyPem, state.device.dhPrivateKeyPem);
  assert.equal(recovered.device.signingPrivateKeyPem, state.device.signingPrivateKeyPem);

  assert.throws(() => {
    openRecoveryBundle({
      bundle,
      passphrase: "wrong horse battery staple",
    });
  }, /authenticate|decrypt|bad/i);
});
