import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  initLocalState,
  linkLocalDevice,
  loadLocalState,
  saveLocalState,
} from "../src/client/state.js";
import { registerStateWithApi, sendTextMessage, syncInboxWithApi } from "../src/client/workflow.js";
import { createDirectApi } from "../src/server/direct-api.js";
import { FileBackedStateStore } from "../src/server/state-store.js";

test("end-to-end send fans out to multiple devices and returns delivery acks", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rmp-e2e-"));
  const dataFile = path.join(tmpRoot, "server-state.json");
  const aliceDir = path.join(tmpRoot, "alice");
  const bobPhoneDir = path.join(tmpRoot, "bob-phone");
  const bobLaptopDir = path.join(tmpRoot, "bob-laptop");
  const store = new FileBackedStateStore(dataFile);
  await store.init();
  const api = createDirectApi(store);

  let alice = await initLocalState({
    stateDir: aliceDir,
    displayName: "Alice",
  });

  let bobPhone = await initLocalState({
    stateDir: bobPhoneDir,
    displayName: "Bob",
  });

  let bobLaptop = await linkLocalDevice({
    sourceStateDir: bobPhoneDir,
    targetStateDir: bobLaptopDir,
  });

  alice = await registerStateWithApi({
    baseUrl: "memory://protocol",
    state: alice,
    api,
  });

  bobPhone = await registerStateWithApi({
    baseUrl: "memory://protocol",
    state: bobPhone,
    api,
  });

  bobLaptop = await registerStateWithApi({
    baseUrl: "memory://protocol",
    state: bobLaptop,
    api,
  });

  await saveLocalState(aliceDir, alice);
  await saveLocalState(bobPhoneDir, bobPhone);
  await saveLocalState(bobLaptopDir, bobLaptop);

  const serverSnapshotAfterRegister = await fs.readFile(dataFile, "utf8");
  assert.equal(serverSnapshotAfterRegister.includes("PrivateKeyPem"), false);
  assert.equal(serverSnapshotAfterRegister.includes("privateKeyPem"), false);

  const sendResult = await sendTextMessage({
    baseUrl: "memory://protocol",
    state: alice,
    recipientAccountId: bobPhone.account.accountId,
    text: "resilient hello",
    api,
  });

  alice = sendResult.state;
  await saveLocalState(aliceDir, alice);

  assert.equal(
    store.state.directory.accounts[bobPhone.account.accountId].devices[bobPhone.device.deviceId]
      .oneTimePreKeys.length,
    4,
  );
  assert.equal(
    store.state.directory.accounts[bobLaptop.account.accountId].devices[bobLaptop.device.deviceId]
      .oneTimePreKeys.length,
    4,
  );

  const relaySnapshotAfterSend = await fs.readFile(dataFile, "utf8");
  assert.equal(relaySnapshotAfterSend.includes("resilient hello"), false);

  const phoneSync = await syncInboxWithApi({
    baseUrl: "memory://protocol",
    state: bobPhone,
    api,
  });

  bobPhone = phoneSync.state;
  await saveLocalState(bobPhoneDir, bobPhone);

  const laptopSync = await syncInboxWithApi({
    baseUrl: "memory://protocol",
    state: bobLaptop,
    api,
  });

  bobLaptop = laptopSync.state;
  await saveLocalState(bobLaptopDir, bobLaptop);

  const aliceAckSync = await syncInboxWithApi({
    baseUrl: "memory://protocol",
    state: alice,
    api,
  });

  alice = aliceAckSync.state;
  await saveLocalState(aliceDir, alice);

  const reloadedBobPhone = await loadLocalState(bobPhoneDir);
  const reloadedBobLaptop = await loadLocalState(bobLaptopDir);
  const reloadedAlice = await loadLocalState(aliceDir);
  const inboundPhone = reloadedBobPhone.events.find((event) => event.kind === "inbound-message");
  const inboundLaptop = reloadedBobLaptop.events.find((event) => event.kind === "inbound-message");
  const outbound = reloadedAlice.events.find((event) => event.kind === "outbound-message");

  assert.equal(sendResult.envelopes.length, 2);
  assert.equal(phoneSync.messages.length, 1);
  assert.equal(laptopSync.messages.length, 1);
  assert.equal(inboundPhone.text, "resilient hello");
  assert.equal(inboundLaptop.text, "resilient hello");
  assert.equal(outbound.status, "delivered");
  assert.equal(outbound.envelopes.filter((entry) => entry.status === "delivered").length, 2);

  const stats = await api.fetchStats();
  assert.equal(stats.accountCount, 2);
  assert.equal(stats.queuedItems, 0);
});

test("revoked devices stop receiving queued and future envelopes", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rmp-revoke-"));
  const dataFile = path.join(tmpRoot, "server-state.json");
  const aliceDir = path.join(tmpRoot, "alice");
  const bobPhoneDir = path.join(tmpRoot, "bob-phone");
  const bobLaptopDir = path.join(tmpRoot, "bob-laptop");
  const store = new FileBackedStateStore(dataFile);
  await store.init();
  const api = createDirectApi(store);

  let alice = await initLocalState({
    stateDir: aliceDir,
    displayName: "Alice",
  });
  let bobPhone = await initLocalState({
    stateDir: bobPhoneDir,
    displayName: "Bob",
  });
  let bobLaptop = await linkLocalDevice({
    sourceStateDir: bobPhoneDir,
    targetStateDir: bobLaptopDir,
  });

  alice = await registerStateWithApi({
    baseUrl: "memory://protocol",
    state: alice,
    api,
  });
  bobPhone = await registerStateWithApi({
    baseUrl: "memory://protocol",
    state: bobPhone,
    api,
  });
  bobLaptop = await registerStateWithApi({
    baseUrl: "memory://protocol",
    state: bobLaptop,
    api,
  });

  const beforeRevocation = await sendTextMessage({
    baseUrl: "memory://protocol",
    state: alice,
    recipientAccountId: bobPhone.account.accountId,
    text: "before revoke",
    api,
  });
  assert.equal(beforeRevocation.envelopes.length, 2);

  await api.revokeDevice(
    "memory://protocol",
    bobPhone.account.accountId,
    bobLaptop.device.deviceId,
    bobPhone.device.deviceId,
  );

  const revokedLaptopSync = await syncInboxWithApi({
    baseUrl: "memory://protocol",
    state: bobLaptop,
    api,
  });
  assert.equal(revokedLaptopSync.queueCount, 0);
  assert.equal(revokedLaptopSync.messages.length, 0);

  const afterRevocation = await sendTextMessage({
    baseUrl: "memory://protocol",
    state: beforeRevocation.state,
    recipientAccountId: bobPhone.account.accountId,
    text: "after revoke",
    api,
  });

  assert.equal(afterRevocation.envelopes.length, 1);
  assert.equal(afterRevocation.envelopes[0].recipientDeviceId, bobPhone.device.deviceId);
});
