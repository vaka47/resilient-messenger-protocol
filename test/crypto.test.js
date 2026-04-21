import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { PAYLOAD_TYPE, createEnvelope } from "../src/index.js";
import { openPayload, sealPayload } from "../src/client/crypto.js";

function exportPem(keyObject, type) {
  return keyObject.export({ format: "pem", type }).toString();
}

test("sealed payload opens for the intended recipient", () => {
  const { publicKey: recipientPublicKey, privateKey: recipientPrivateKey } =
    crypto.generateKeyPairSync("x25519");
  const { publicKey: senderSigningPublicKey, privateKey: senderSigningPrivateKey } =
    crypto.generateKeyPairSync("ed25519");

  const aad = {
    conversationId: "conv-1",
    senderAccountId: "acct-1",
    senderDeviceId: "dev-1",
    payloadType: PAYLOAD_TYPE.MESSAGE,
    recipientInboxIds: ["inbox-1"],
  };

  const ciphertext = sealPayload({
    plaintext: {
      text: "hello",
    },
    aad,
    recipientDhPublicKeyPem: exportPem(recipientPublicKey, "spki"),
    senderSigningPrivateKeyPem: exportPem(senderSigningPrivateKey, "pkcs8"),
  });

  const envelope = createEnvelope({
    conversationId: "conv-1",
    senderAccountId: "acct-1",
    senderDeviceId: "dev-1",
    recipientInboxIds: ["inbox-1"],
    payloadType: PAYLOAD_TYPE.MESSAGE,
    ciphertext,
  });

  const opened = openPayload({
    envelope,
    ciphertext,
    recipientDhPrivateKeyPem: exportPem(recipientPrivateKey, "pkcs8"),
    senderSigningPublicKeyPem: exportPem(senderSigningPublicKey, "spki"),
  });

  assert.equal(opened.text, "hello");
});

test("sealed payload fails after tampering", () => {
  const { publicKey: recipientPublicKey, privateKey: recipientPrivateKey } =
    crypto.generateKeyPairSync("x25519");
  const { publicKey: senderSigningPublicKey, privateKey: senderSigningPrivateKey } =
    crypto.generateKeyPairSync("ed25519");

  const aad = {
    conversationId: "conv-1",
    senderAccountId: "acct-1",
    senderDeviceId: "dev-1",
    payloadType: PAYLOAD_TYPE.MESSAGE,
    recipientInboxIds: ["inbox-1"],
  };

  const ciphertext = sealPayload({
    plaintext: {
      text: "hello",
    },
    aad,
    recipientDhPublicKeyPem: exportPem(recipientPublicKey, "spki"),
    senderSigningPrivateKeyPem: exportPem(senderSigningPrivateKey, "pkcs8"),
  });

  const parsed = JSON.parse(ciphertext);
  parsed.body.ciphertextB64 = Buffer.from("tampered", "utf8").toString("base64");

  const envelope = createEnvelope({
    conversationId: "conv-1",
    senderAccountId: "acct-1",
    senderDeviceId: "dev-1",
    recipientInboxIds: ["inbox-1"],
    payloadType: PAYLOAD_TYPE.MESSAGE,
    ciphertext: JSON.stringify(parsed),
  });

  assert.throws(() => {
    openPayload({
      envelope,
      ciphertext: envelope.ciphertext,
      recipientDhPrivateKeyPem: exportPem(recipientPrivateKey, "pkcs8"),
      senderSigningPublicKeyPem: exportPem(senderSigningPublicKey, "spki"),
    });
  });
});
