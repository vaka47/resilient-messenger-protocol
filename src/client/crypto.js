import crypto from "node:crypto";

import { stableStringify } from "../util.js";

export const ENVELOPE_ALGORITHM = "RMP-PROTOTYPE-X25519-HKDF-SHA256-AES-256-GCM-ED25519";
const HKDF_INFO = Buffer.from("rmp-envelope-v1", "utf8");

export function getEnvelopeSecurityProfile() {
  return {
    algorithm: ENVELOPE_ALGORITHM,
    relayReadable: false,
    productionReady: false,
    reason:
      "This envelope layer protects payloads from relays, but production E2EE still requires Double Ratchet for 1:1 chats and MLS for groups.",
  };
}

function createKeyObjectsFromPem({ publicKeyPem, privateKeyPem }) {
  return {
    publicKey: publicKeyPem ? crypto.createPublicKey(publicKeyPem) : null,
    privateKey: privateKeyPem ? crypto.createPrivateKey(privateKeyPem) : null,
  };
}

function deriveMessageKey(sharedSecret, salt) {
  return Buffer.from(crypto.hkdfSync("sha256", sharedSecret, salt, HKDF_INFO, 32));
}

export function deriveConversationId(accountIds) {
  if (!Array.isArray(accountIds) || accountIds.length === 0) {
    throw new TypeError("accountIds must be a non-empty array");
  }

  const canonical = [...accountIds].sort().join(":");
  return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

export function sealPayload({
  plaintext,
  aad,
  recipientDhPublicKeyPem,
  senderSigningPrivateKeyPem,
}) {
  const { publicKey: recipientDhPublicKey } = createKeyObjectsFromPem({
    publicKeyPem: recipientDhPublicKeyPem,
  });

  const { privateKey: senderSigningPrivateKey } = createKeyObjectsFromPem({
    privateKeyPem: senderSigningPrivateKeyPem,
  });

  const { publicKey: ephemeralPublicKey, privateKey: ephemeralPrivateKey } =
    crypto.generateKeyPairSync("x25519");

  const sharedSecret = crypto.diffieHellman({
    privateKey: ephemeralPrivateKey,
    publicKey: recipientDhPublicKey,
  });

  const salt = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const key = deriveMessageKey(sharedSecret, salt);
  const aadBuffer = Buffer.from(stableStringify(aad), "utf8");
  const plaintextBuffer = Buffer.from(JSON.stringify(plaintext), "utf8");

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aadBuffer);
  const ciphertext = Buffer.concat([cipher.update(plaintextBuffer), cipher.final()]);
  const tag = cipher.getAuthTag();

  const body = {
    alg: ENVELOPE_ALGORITHM,
    epkPem: ephemeralPublicKey.export({ format: "pem", type: "spki" }).toString(),
    saltB64: salt.toString("base64"),
    ivB64: iv.toString("base64"),
    ciphertextB64: ciphertext.toString("base64"),
    tagB64: tag.toString("base64"),
  };

  const signedPayload = stableStringify({ aad, body });
  const signature = crypto.sign(null, Buffer.from(signedPayload, "utf8"), senderSigningPrivateKey);

  return stableStringify({
    version: 1,
    aad,
    body,
    signatureB64: signature.toString("base64"),
  });
}

export function openPayload({
  envelope,
  ciphertext,
  recipientDhPrivateKeyPem,
  senderSigningPublicKeyPem,
}) {
  const parsed = JSON.parse(ciphertext);

  if (parsed.body?.alg !== ENVELOPE_ALGORITHM) {
    throw new Error("Unsupported envelope algorithm");
  }

  const expectedAad = {
    conversationId: envelope.conversationId,
    senderAccountId: envelope.sender.accountId,
    senderDeviceId: envelope.sender.deviceId,
    payloadType: envelope.payloadType,
    recipientInboxIds: envelope.recipients.map((recipient) => recipient.inboxId),
  };

  if (stableStringify(parsed.aad) !== stableStringify(expectedAad)) {
    throw new Error("Envelope AAD does not match the ciphertext package");
  }

  const { privateKey: recipientDhPrivateKey } = createKeyObjectsFromPem({
    privateKeyPem: recipientDhPrivateKeyPem,
  });

  const { publicKey: senderSigningPublicKey } = createKeyObjectsFromPem({
    publicKeyPem: senderSigningPublicKeyPem,
  });

  const signedPayload = stableStringify({
    aad: parsed.aad,
    body: parsed.body,
  });

  const signatureOk = crypto.verify(
    null,
    Buffer.from(signedPayload, "utf8"),
    senderSigningPublicKey,
    Buffer.from(parsed.signatureB64, "base64"),
  );

  if (!signatureOk) {
    throw new Error("Envelope signature verification failed");
  }

  const senderEphemeralPublicKey = crypto.createPublicKey(parsed.body.epkPem);
  const sharedSecret = crypto.diffieHellman({
    privateKey: recipientDhPrivateKey,
    publicKey: senderEphemeralPublicKey,
  });

  const salt = Buffer.from(parsed.body.saltB64, "base64");
  const iv = Buffer.from(parsed.body.ivB64, "base64");
  const ciphertextBuffer = Buffer.from(parsed.body.ciphertextB64, "base64");
  const tag = Buffer.from(parsed.body.tagB64, "base64");
  const key = deriveMessageKey(sharedSecret, salt);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(stableStringify(parsed.aad), "utf8"));
  decipher.setAuthTag(tag);

  const plaintext = Buffer.concat([decipher.update(ciphertextBuffer), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8"));
}
