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

  const sendResult = await sendTextMessage({
    baseUrl: "memory://protocol",
    state: alice,
    recipientAccountId: bobPhone.account.accountId,
    text: "resilient hello",
    api,
  });

  alice = sendResult.state;
  await saveLocalState(aliceDir, alice);

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
