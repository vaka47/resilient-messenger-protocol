import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  createPairwiseSession,
  openWithSession,
  sealAndSignWithSession,
} from "../src/client/ratchet.js";

function exportPem(keyObject, type) {
  return keyObject.export({ format: "pem", type }).toString();
}

function createDevice(accountId, deviceId) {
  const { publicKey: dhPublicKey, privateKey: dhPrivateKey } =
    crypto.generateKeyPairSync("x25519");
  const { publicKey: signingPublicKey, privateKey: signingPrivateKey } =
    crypto.generateKeyPairSync("ed25519");

  return {
    accountId,
    deviceId,
    inboxId: `${deviceId}-inbox`,
    dhPublicKeyPem: exportPem(dhPublicKey, "spki"),
    dhPrivateKeyPem: exportPem(dhPrivateKey, "pkcs8"),
    signingPublicKeyPem: exportPem(signingPublicKey, "spki"),
    signingPrivateKeyPem: exportPem(signingPrivateKey, "pkcs8"),
  };
}

function aad(from, to) {
  return {
    conversationId: "conv",
    senderAccountId: from.accountId,
    senderDeviceId: from.deviceId,
    payloadType: "message",
    recipientInboxIds: [to.inboxId],
  };
}

test("pairwise ratchet derives matching directional chains", () => {
  const alice = createDevice("alice", "alice-phone");
  const bob = createDevice("bob", "bob-phone");
  const aliceSession = createPairwiseSession({
    localDevice: alice,
    remoteDevice: bob,
    localAccountId: alice.accountId,
    remoteAccountId: bob.accountId,
  });
  const bobSession = createPairwiseSession({
    localDevice: bob,
    remoteDevice: alice,
    localAccountId: bob.accountId,
    remoteAccountId: alice.accountId,
    role: "responder",
  });

  assert.equal(aliceSession.rootKeyDigest, bobSession.rootKeyDigest);
  assert.equal(aliceSession.send.chainKeyB64, bobSession.receive.chainKeyB64);

  const sealed = sealAndSignWithSession({
    session: aliceSession,
    plaintext: {
      text: "ratcheted hello",
    },
    aad: aad(alice, bob),
    senderSigningPrivateKeyPem: alice.signingPrivateKeyPem,
  });

  const opened = openWithSession({
    session: bobSession,
    sealed: sealed.sealed,
    expectedAad: aad(alice, bob),
    senderSigningPublicKeyPem: alice.signingPublicKeyPem,
  });

  assert.equal(opened.plaintext.text, "ratcheted hello");
  assert.equal(sealed.session.send.index, 1);
  assert.equal(opened.session.receive.index, 1);

  assert.throws(() => {
    openWithSession({
      session: opened.session,
      sealed: sealed.sealed,
      expectedAad: aad(alice, bob),
      senderSigningPublicKeyPem: alice.signingPublicKeyPem,
    });
  }, /Unexpected ratchet message index/);
});

test("ratchet stores skipped keys for out-of-order messages", () => {
  const alice = createDevice("alice", "alice-phone");
  const bob = createDevice("bob", "bob-phone");
  let aliceSession = createPairwiseSession({
    localDevice: alice,
    remoteDevice: bob,
    localAccountId: alice.accountId,
    remoteAccountId: bob.accountId,
  });
  let bobSession = createPairwiseSession({
    localDevice: bob,
    remoteDevice: alice,
    localAccountId: bob.accountId,
    remoteAccountId: alice.accountId,
    role: "responder",
  });

  const first = sealAndSignWithSession({
    session: aliceSession,
    plaintext: { text: "first" },
    aad: aad(alice, bob),
    senderSigningPrivateKeyPem: alice.signingPrivateKeyPem,
  });
  aliceSession = first.session;
  const second = sealAndSignWithSession({
    session: aliceSession,
    plaintext: { text: "second" },
    aad: aad(alice, bob),
    senderSigningPrivateKeyPem: alice.signingPrivateKeyPem,
  });

  const openedSecond = openWithSession({
    session: bobSession,
    sealed: second.sealed,
    expectedAad: aad(alice, bob),
    senderSigningPublicKeyPem: alice.signingPublicKeyPem,
  });
  bobSession = openedSecond.session;

  assert.equal(openedSecond.plaintext.text, "second");
  assert.equal(Object.keys(bobSession.skippedMessageKeys).length, 1);

  const openedFirst = openWithSession({
    session: bobSession,
    sealed: first.sealed,
    expectedAad: aad(alice, bob),
    senderSigningPublicKeyPem: alice.signingPublicKeyPem,
  });

  assert.equal(openedFirst.plaintext.text, "first");
  assert.equal(Object.keys(openedFirst.session.skippedMessageKeys).length, 0);
});

test("recipient DH ratchet turn changes the sender chain for replies", () => {
  const alice = createDevice("alice", "alice-phone");
  const bob = createDevice("bob", "bob-phone");
  let aliceSession = createPairwiseSession({
    localDevice: alice,
    remoteDevice: bob,
    localAccountId: alice.accountId,
    remoteAccountId: bob.accountId,
  });
  let bobSession = createPairwiseSession({
    localDevice: bob,
    remoteDevice: alice,
    localAccountId: bob.accountId,
    remoteAccountId: alice.accountId,
    role: "responder",
  });

  const aliceMessage = sealAndSignWithSession({
    session: aliceSession,
    plaintext: { text: "ping" },
    aad: aad(alice, bob),
    senderSigningPrivateKeyPem: alice.signingPrivateKeyPem,
  });
  aliceSession = aliceMessage.session;

  const openedByBob = openWithSession({
    session: bobSession,
    sealed: aliceMessage.sealed,
    expectedAad: aad(alice, bob),
    senderSigningPublicKeyPem: alice.signingPublicKeyPem,
  });
  bobSession = openedByBob.session;

  const bobReply = sealAndSignWithSession({
    session: bobSession,
    plaintext: { text: "pong" },
    aad: aad(bob, alice),
    senderSigningPrivateKeyPem: bob.signingPrivateKeyPem,
  });

  const openedByAlice = openWithSession({
    session: aliceSession,
    sealed: bobReply.sealed,
    expectedAad: aad(bob, alice),
    senderSigningPublicKeyPem: bob.signingPublicKeyPem,
  });

  assert.equal(openedByAlice.plaintext.text, "pong");
  assert.notEqual(openedByAlice.session.rootKeyDigest, aliceSession.rootKeyDigest);
});
