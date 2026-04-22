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

test("pairwise ratchet derives matching directional chains", () => {
  const { publicKey: aliceDhPublicKey, privateKey: aliceDhPrivateKey } =
    crypto.generateKeyPairSync("x25519");
  const { publicKey: bobDhPublicKey, privateKey: bobDhPrivateKey } =
    crypto.generateKeyPairSync("x25519");
  const { publicKey: aliceSigningPublicKey, privateKey: aliceSigningPrivateKey } =
    crypto.generateKeyPairSync("ed25519");

  const aliceSession = createPairwiseSession({
    localDhPrivateKeyPem: exportPem(aliceDhPrivateKey, "pkcs8"),
    remoteDhPublicKeyPem: exportPem(bobDhPublicKey, "spki"),
    localAccountId: "alice",
    localDeviceId: "alice-phone",
    remoteAccountId: "bob",
    remoteDeviceId: "bob-phone",
  });

  const bobSession = createPairwiseSession({
    localDhPrivateKeyPem: exportPem(bobDhPrivateKey, "pkcs8"),
    remoteDhPublicKeyPem: exportPem(aliceDhPublicKey, "spki"),
    localAccountId: "bob",
    localDeviceId: "bob-phone",
    remoteAccountId: "alice",
    remoteDeviceId: "alice-phone",
  });

  assert.equal(aliceSession.rootKeyDigest, bobSession.rootKeyDigest);
  assert.equal(aliceSession.send.chainKeyB64, bobSession.receive.chainKeyB64);

  const aad = {
    conversationId: "conv",
    senderAccountId: "alice",
    senderDeviceId: "alice-phone",
    payloadType: "message",
    recipientInboxIds: ["bob-inbox"],
  };

  const sealed = sealAndSignWithSession({
    session: aliceSession,
    plaintext: {
      text: "ratcheted hello",
    },
    aad,
    senderSigningPrivateKeyPem: exportPem(aliceSigningPrivateKey, "pkcs8"),
  });

  const opened = openWithSession({
    session: bobSession,
    sealed: sealed.sealed,
    expectedAad: aad,
    senderSigningPublicKeyPem: exportPem(aliceSigningPublicKey, "spki"),
  });

  assert.equal(opened.plaintext.text, "ratcheted hello");
  assert.equal(sealed.session.send.index, 1);
  assert.equal(opened.session.receive.index, 1);

  assert.throws(() => {
    openWithSession({
      session: opened.session,
      sealed: sealed.sealed,
      expectedAad: aad,
      senderSigningPublicKeyPem: exportPem(aliceSigningPublicKey, "spki"),
    });
  }, /Unexpected ratchet message index/);
});
