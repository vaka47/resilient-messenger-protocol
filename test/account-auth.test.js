import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { PAYLOAD_TYPE, PRIORITY, createEnvelope } from "../src/index.js";
import { initLocalState, linkLocalDevice } from "../src/client/state.js";
import {
  bootstrapStateWithApi,
  completeRegistrationStateWithApi,
  registerStateWithApi,
} from "../src/client/workflow.js";
import { createDirectApi } from "../src/server/direct-api.js";
import { FileBackedStateStore } from "../src/server/state-store.js";

async function createStore(rootPrefix) {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), rootPrefix));
  const store = new FileBackedStateStore(path.join(tmpRoot, "server-state.json"));
  await store.init();

  return {
    tmpRoot,
    store,
    api: createDirectApi(store),
  };
}

test("QR-only account registration enforces phone ownership and passwords", async () => {
  const { tmpRoot, store, api } = await createStore("rmp-account-auth-");
  let alice = await initLocalState({
    stateDir: path.join(tmpRoot, "alice"),
    displayName: "Alice",
  });
  let bob = await initLocalState({
    stateDir: path.join(tmpRoot, "bob"),
    displayName: "Bob",
  });
  let carol = await initLocalState({
    stateDir: path.join(tmpRoot, "carol"),
    displayName: "Carol",
  });

  await assert.rejects(
    registerStateWithApi({
      baseUrl: "memory://protocol",
      state: bob,
      api,
      password: "bob-password-123",
    }),
    /not active/,
  );

  alice = await bootstrapStateWithApi({
    baseUrl: "memory://protocol",
    state: alice,
    api,
    phone: "+10000001001",
    password: "alice-password-123",
    passwordConfirm: "alice-password-123",
  });

  assert.equal(alice.account.phone, "+10000001001");
  assert.equal("passwordRecord" in alice.account, false);
  assert.equal(store.state.directory.phoneIndex["+10000001001"], alice.account.accountId);

  await assert.rejects(
    api.loginByPhone("memory://protocol", "+10000001001", "wrong-password-123"),
    /invalid phone or password/,
  );
  const login = await api.loginByPhone(
    "memory://protocol",
    "+10000001001",
    "alice-password-123",
  );
  assert.equal(login.account.accountId, alice.account.accountId);
  assert.equal("passwordRecord" in login.account, false);

  await assert.rejects(
    bootstrapStateWithApi({
      baseUrl: "memory://protocol",
      state: bob,
      api,
      phone: "+10000001002",
      password: "bob-password-123",
      passwordConfirm: "bob-password-123",
    }),
    /bootstrap is allowed only for the first account/,
  );

  await assert.rejects(
    api.createQrInvite("memory://protocol", "missing-sponsor-account", "+10000001002"),
    /not active/,
  );

  const bobInvite = await api.createQrInvite(
    "memory://protocol",
    alice.account.accountId,
    "+10000001002",
  );
  assert.equal(bobInvite.request.mode, "qr");
  assert.equal(bobInvite.request.purpose, "registration");
  assert.equal("qrTokenRecord" in bobInvite.request, false);
  assert.equal(bobInvite.qrPayload.type, "rmp.qr-invite.v1");

  const replacementInvite = await api.createQrInvite(
    "memory://protocol",
    alice.account.accountId,
    "+10000001002",
  );
  assert.equal(
    store.state.directory.inviteRequests[bobInvite.request.requestId].status,
    "replaced",
  );

  await assert.rejects(
    completeRegistrationStateWithApi({
      baseUrl: "memory://protocol",
      state: bob,
      api,
      requestId: bobInvite.request.requestId,
      qrToken: bobInvite.qrToken,
      phone: "+10000001002",
      password: "bob-password-123",
      passwordConfirm: "bob-password-123",
    }),
    /invite request is not approved/,
  );

  await assert.rejects(
    completeRegistrationStateWithApi({
      baseUrl: "memory://protocol",
      state: bob,
      api,
      requestId: replacementInvite.request.requestId,
      qrToken: "wrong-qr-token",
      phone: "+10000001002",
      password: "bob-password-123",
      passwordConfirm: "bob-password-123",
    }),
    /invalid QR invite token/,
  );

  await assert.rejects(
    completeRegistrationStateWithApi({
      baseUrl: "memory://protocol",
      state: bob,
      api,
      requestId: replacementInvite.request.requestId,
      qrToken: replacementInvite.qrToken,
      phone: "+10000001003",
      password: "bob-password-123",
      passwordConfirm: "bob-password-123",
    }),
    /phone does not match invite request/,
  );

  bob = await completeRegistrationStateWithApi({
    baseUrl: "memory://protocol",
    state: bob,
    api,
    requestId: replacementInvite.request.requestId,
    qrToken: replacementInvite.qrToken,
    phone: "+10000001002",
    password: "bob-password-123",
    passwordConfirm: "bob-password-123",
  });

  assert.equal(bob.account.invitedByAccountId, alice.account.accountId);
  assert.equal(store.state.directory.phoneIndex["+10000001002"], bob.account.accountId);

  await assert.rejects(
    completeRegistrationStateWithApi({
      baseUrl: "memory://protocol",
      state: bob,
      api,
      requestId: replacementInvite.request.requestId,
      qrToken: replacementInvite.qrToken,
      phone: "+10000001002",
      password: "bob-password-123",
      passwordConfirm: "bob-password-123",
    }),
    /invite request is not approved/,
  );

  const bobLaptop = await linkLocalDevice({
    sourceStateDir: path.join(tmpRoot, "bob"),
    targetStateDir: path.join(tmpRoot, "bob-laptop"),
  });

  await assert.rejects(
    registerStateWithApi({
      baseUrl: "memory://protocol",
      state: bobLaptop,
      api,
      password: "wrong-password-123",
    }),
    /invalid account password/,
  );
  await registerStateWithApi({
    baseUrl: "memory://protocol",
    state: bobLaptop,
    api,
    password: "bob-password-123",
  });

  const carolInvite = await api.createQrInvite(
    "memory://protocol",
    bob.account.accountId,
    "+10000001003",
  );
  carol = await completeRegistrationStateWithApi({
    baseUrl: "memory://protocol",
    state: carol,
    api,
    requestId: carolInvite.request.requestId,
    qrToken: carolInvite.qrToken,
    phone: "+10000001003",
    password: "carol-password-123",
    passwordConfirm: "carol-password-123",
  });

  assert.equal(carol.account.invitedByAccountId, bob.account.accountId);

  const publicBob = await api.lookupAccount("memory://protocol", bob.account.accountId);
  assert.equal("passwordRecord" in publicBob.account, false);
  assert.equal(publicBob.account.devices[bob.device.deviceId].oneTimePreKeyIds.length, 5);
  assert.equal("oneTimePreKeys" in publicBob.account.devices[bob.device.deviceId], false);
});

test("original inviter can reset a forgotten password by issuing a replacement QR invite", async () => {
  const { tmpRoot, store, api } = await createStore("rmp-password-reset-");
  let alice = await initLocalState({
    stateDir: path.join(tmpRoot, "alice"),
    displayName: "Alice",
  });
  let bob = await initLocalState({
    stateDir: path.join(tmpRoot, "bob"),
    displayName: "Bob",
  });
  const bobResetDevice = await initLocalState({
    stateDir: path.join(tmpRoot, "bob-reset"),
    displayName: "Bob",
  });

  alice = await bootstrapStateWithApi({
    baseUrl: "memory://protocol",
    state: alice,
    api,
    phone: "+10000001101",
    password: "alice-password-123",
    passwordConfirm: "alice-password-123",
  });
  const bobInvite = await api.createQrInvite(
    "memory://protocol",
    alice.account.accountId,
    "+10000001102",
  );
  bob = await completeRegistrationStateWithApi({
    baseUrl: "memory://protocol",
    state: bob,
    api,
    requestId: bobInvite.request.requestId,
    qrToken: bobInvite.qrToken,
    phone: "+10000001102",
    password: "old-bob-password-123",
    passwordConfirm: "old-bob-password-123",
  });

  const resetInvite = await api.createQrInvite(
    "memory://protocol",
    alice.account.accountId,
    "+10000001102",
  );
  assert.equal(resetInvite.request.purpose, "password-reset");

  const resetState = await completeRegistrationStateWithApi({
    baseUrl: "memory://protocol",
    state: bobResetDevice,
    api,
    requestId: resetInvite.request.requestId,
    qrToken: resetInvite.qrToken,
    phone: "+10000001102",
    password: "new-bob-password-123",
    passwordConfirm: "new-bob-password-123",
  });

  assert.equal(resetState.account.accountId, bob.account.accountId);
  assert.equal(store.state.directory.accounts[bob.account.accountId].invitedByAccountId, alice.account.accountId);
  assert.equal(store.state.directory.accounts[bob.account.accountId].devices[resetState.device.deviceId].deviceId, resetState.device.deviceId);

  await assert.rejects(
    api.loginByPhone("memory://protocol", "+10000001102", "old-bob-password-123"),
    /invalid phone or password/,
  );
  const login = await api.loginByPhone(
    "memory://protocol",
    "+10000001102",
    "new-bob-password-123",
  );
  assert.equal(login.account.accountId, bob.account.accountId);
});

test("relay queues envelopes only for active addressed devices", async () => {
  const { tmpRoot, api } = await createStore("rmp-delivery-auth-");
  let alice = await initLocalState({
    stateDir: path.join(tmpRoot, "alice"),
    displayName: "Alice",
  });
  let bob = await initLocalState({
    stateDir: path.join(tmpRoot, "bob"),
    displayName: "Bob",
  });

  alice = await bootstrapStateWithApi({
    baseUrl: "memory://protocol",
    state: alice,
    api,
    phone: "+10000002001",
    password: "alice-password-123",
    passwordConfirm: "alice-password-123",
  });
  const invite = await api.createQrInvite(
    "memory://protocol",
    alice.account.accountId,
    "+10000002002",
  );
  bob = await completeRegistrationStateWithApi({
    baseUrl: "memory://protocol",
    state: bob,
    api,
    requestId: invite.request.requestId,
    qrToken: invite.qrToken,
    phone: "+10000002002",
    password: "bob-password-123",
    passwordConfirm: "bob-password-123",
  });

  const envelope = createEnvelope({
    conversationId: "conversation-1",
    senderAccountId: alice.account.accountId,
    senderDeviceId: alice.device.deviceId,
    recipientInboxIds: [bob.device.inboxId],
    payloadType: PAYLOAD_TYPE.MESSAGE,
    priority: PRIORITY.NORMAL,
    ciphertext: "ciphertext",
  });

  await assert.rejects(
    api.enqueueEnvelope("memory://protocol", { recipients: [] }, bob.device.inboxId),
    /Invalid envelope/,
  );

  await assert.rejects(
    api.enqueueEnvelope("memory://protocol", envelope, alice.device.inboxId),
    /not addressed/,
  );

  const forgedSenderEnvelope = createEnvelope({
    conversationId: "conversation-2",
    senderAccountId: "forged-account",
    senderDeviceId: "forged-device",
    recipientInboxIds: [bob.device.inboxId],
    payloadType: PAYLOAD_TYPE.MESSAGE,
    priority: PRIORITY.NORMAL,
    ciphertext: "ciphertext",
  });
  await assert.rejects(
    api.enqueueEnvelope("memory://protocol", forgedSenderEnvelope, bob.device.inboxId),
    /sender is not an active registered device/,
  );

  const unknownRecipientEnvelope = createEnvelope({
    conversationId: "conversation-3",
    senderAccountId: alice.account.accountId,
    senderDeviceId: alice.device.deviceId,
    recipientInboxIds: ["unknown-inbox"],
    payloadType: PAYLOAD_TYPE.MESSAGE,
    priority: PRIORITY.NORMAL,
    ciphertext: "ciphertext",
  });
  await assert.rejects(
    api.enqueueEnvelope("memory://protocol", unknownRecipientEnvelope, "unknown-inbox"),
    /not an active registered device/,
  );

  const result = await api.enqueueEnvelope("memory://protocol", envelope, bob.device.inboxId);
  assert.equal(result.item.recipientInboxId, bob.device.inboxId);
});
