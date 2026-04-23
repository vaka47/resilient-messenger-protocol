import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  assertPqxdhKemProvider,
  combinePqxdhSharedSecret,
  decapsulatePqxdhSecret,
  deriveX3dhAssociatedData,
  deriveX3dhInitiatorSecret,
  deriveX3dhResponderSecret,
  encapsulatePqxdhSecret,
} from "../src/index.js";

function x25519Pair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519");

  return {
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  };
}

test("X3DH adapter derives the same shared secret on both sides", () => {
  const initiatorIdentity = x25519Pair();
  const initiatorEphemeral = x25519Pair();
  const responderIdentity = x25519Pair();
  const responderSignedPreKey = x25519Pair();
  const responderOneTimePreKey = x25519Pair();

  const initiatorSecret = deriveX3dhInitiatorSecret({
    initiatorIdentityPrivateKeyPem: initiatorIdentity.privateKeyPem,
    initiatorEphemeralPrivateKeyPem: initiatorEphemeral.privateKeyPem,
    responderIdentityPublicKeyPem: responderIdentity.publicKeyPem,
    responderSignedPreKeyPublicKeyPem: responderSignedPreKey.publicKeyPem,
    responderOneTimePreKeyPublicKeyPem: responderOneTimePreKey.publicKeyPem,
  });
  const responderSecret = deriveX3dhResponderSecret({
    responderIdentityPrivateKeyPem: responderIdentity.privateKeyPem,
    responderSignedPreKeyPrivateKeyPem: responderSignedPreKey.privateKeyPem,
    responderOneTimePreKeyPrivateKeyPem: responderOneTimePreKey.privateKeyPem,
    initiatorIdentityPublicKeyPem: initiatorIdentity.publicKeyPem,
    initiatorEphemeralPublicKeyPem: initiatorEphemeral.publicKeyPem,
  });

  assert.equal(initiatorSecret.equals(responderSecret), true);
  assert.equal(initiatorSecret.length, 32);

  const associatedData = deriveX3dhAssociatedData({
    initiatorIdentityPublicKeyPem: initiatorIdentity.publicKeyPem,
    responderIdentityPublicKeyPem: responderIdentity.publicKeyPem,
  });
  assert.equal(associatedData.includes("BEGIN PUBLIC KEY"), true);
});

test("PQXDH adapter refuses silent downgrade and combines KEM secrets explicitly", () => {
  assert.throws(() => assertPqxdhKemProvider(null), /requires an audited KEM provider/);

  const x3dhSharedSecret = crypto.randomBytes(32);
  const kemSharedSecret = crypto.randomBytes(32);
  const combined = combinePqxdhSharedSecret({
    x3dhSharedSecret,
    kemSharedSecret,
    kemName: "TEST-KEM",
  });
  assert.equal(combined.length, 32);

  const provider = {
    name: "TEST-KEM",
    encapsulate() {
      return {
        ciphertext: Buffer.from("test-ciphertext"),
        sharedSecret: kemSharedSecret,
      };
    },
    decapsulate() {
      return kemSharedSecret;
    },
  };

  const encapsulated = encapsulatePqxdhSecret({
    provider,
    x3dhSharedSecret,
    remoteKemPublicKey: Buffer.from("public"),
  });
  const decapsulated = decapsulatePqxdhSecret({
    provider,
    x3dhSharedSecret,
    localKemPrivateKey: Buffer.from("private"),
    ciphertext: encapsulated.ciphertext,
  });

  assert.equal(encapsulated.sharedSecret.equals(decapsulated.sharedSecret), true);
  assert.equal(encapsulated.kemName, "TEST-KEM");
});
