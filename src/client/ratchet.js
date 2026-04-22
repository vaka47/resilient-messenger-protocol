import crypto from "node:crypto";

import { stableStringify } from "../util.js";

export const RATCHET_PROFILE = "RMP-PROTOTYPE-SYMMETRIC-RATCHET-V1";

const ROOT_INFO = Buffer.from("rmp-ratchet-root-v1", "utf8");
const CHAIN_INFO = Buffer.from("rmp-ratchet-chain-v1", "utf8");
const MESSAGE_INFO = Buffer.from("rmp-ratchet-message-v1", "utf8");

function hkdf(input, salt, info, length = 32) {
  return Buffer.from(crypto.hkdfSync("sha256", input, salt, info, length));
}

function hmac(key, value) {
  return crypto.createHmac("sha256", key).update(value).digest();
}

function createKeyObjectsFromPem({ publicKeyPem, privateKeyPem }) {
  return {
    publicKey: publicKeyPem ? crypto.createPublicKey(publicKeyPem) : null,
    privateKey: privateKeyPem ? crypto.createPrivateKey(privateKeyPem) : null,
  };
}

function canonicalPair(localDeviceId, remoteDeviceId) {
  return [localDeviceId, remoteDeviceId].sort().join(":");
}

function directionLabel(senderDeviceId, recipientDeviceId) {
  return `${senderDeviceId}->${recipientDeviceId}`;
}

function sessionIdFor(localDeviceId, remoteDeviceId) {
  return crypto
    .createHash("sha256")
    .update(canonicalPair(localDeviceId, remoteDeviceId))
    .digest("hex")
    .slice(0, 32);
}

function deriveRootKey({ localDhPrivateKeyPem, remoteDhPublicKeyPem, localDeviceId, remoteDeviceId }) {
  const { privateKey: localDhPrivateKey } = createKeyObjectsFromPem({
    privateKeyPem: localDhPrivateKeyPem,
  });
  const { publicKey: remoteDhPublicKey } = createKeyObjectsFromPem({
    publicKeyPem: remoteDhPublicKeyPem,
  });

  const sharedSecret = crypto.diffieHellman({
    privateKey: localDhPrivateKey,
    publicKey: remoteDhPublicKey,
  });

  return hkdf(
    sharedSecret,
    Buffer.from(canonicalPair(localDeviceId, remoteDeviceId), "utf8"),
    ROOT_INFO,
  );
}

function deriveChainKey(rootKey, senderDeviceId, recipientDeviceId) {
  return hkdf(
    rootKey,
    Buffer.from(directionLabel(senderDeviceId, recipientDeviceId), "utf8"),
    CHAIN_INFO,
  );
}

function stepChain(chainKey) {
  return {
    messageKey: hmac(chainKey, MESSAGE_INFO),
    nextChainKey: hmac(chainKey, CHAIN_INFO),
  };
}

export function createPairwiseSession({
  localDhPrivateKeyPem,
  remoteDhPublicKeyPem,
  localAccountId,
  localDeviceId,
  remoteAccountId,
  remoteDeviceId,
}) {
  const rootKey = deriveRootKey({
    localDhPrivateKeyPem,
    remoteDhPublicKeyPem,
    localDeviceId,
    remoteDeviceId,
  });

  return {
    version: 1,
    profile: RATCHET_PROFILE,
    sessionId: sessionIdFor(localDeviceId, remoteDeviceId),
    localAccountId,
    localDeviceId,
    remoteAccountId,
    remoteDeviceId,
    rootKeyDigest: crypto.createHash("sha256").update(rootKey).digest("hex"),
    send: {
      chainKeyB64: deriveChainKey(rootKey, localDeviceId, remoteDeviceId).toString("base64"),
      index: 0,
    },
    receive: {
      chainKeyB64: deriveChainKey(rootKey, remoteDeviceId, localDeviceId).toString("base64"),
      index: 0,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function getSessionKey(localDeviceId, remoteDeviceId) {
  return `${localDeviceId}:${remoteDeviceId}`;
}

export function getOrCreatePairwiseSession({ state, remoteAccountId, remoteDevice }) {
  const sessionKey = getSessionKey(state.device.deviceId, remoteDevice.deviceId);
  const existing = state.sessions?.[sessionKey];

  if (existing) {
    return {
      state,
      session: existing,
      sessionKey,
    };
  }

  const session = createPairwiseSession({
    localDhPrivateKeyPem: state.device.dhPrivateKeyPem,
    remoteDhPublicKeyPem: remoteDevice.dhPublicKeyPem,
    localAccountId: state.account.accountId,
    localDeviceId: state.device.deviceId,
    remoteAccountId,
    remoteDeviceId: remoteDevice.deviceId,
  });

  return {
    state: {
      ...state,
      sessions: {
        ...(state.sessions || {}),
        [sessionKey]: session,
      },
    },
    session,
    sessionKey,
  };
}

export function sealWithSession({ session, plaintext, aad }) {
  const chainKey = Buffer.from(session.send.chainKeyB64, "base64");
  const { messageKey, nextChainKey } = stepChain(chainKey);
  const iv = crypto.randomBytes(12);
  const aadBuffer = Buffer.from(stableStringify(aad), "utf8");
  const plaintextBuffer = Buffer.from(JSON.stringify(plaintext), "utf8");
  const cipher = crypto.createCipheriv("aes-256-gcm", messageKey, iv);
  cipher.setAAD(aadBuffer);
  const ciphertext = Buffer.concat([cipher.update(plaintextBuffer), cipher.final()]);
  const tag = cipher.getAuthTag();

  const body = {
      version: 1,
      profile: RATCHET_PROFILE,
      sessionId: session.sessionId,
      senderDeviceId: session.localDeviceId,
      recipientDeviceId: session.remoteDeviceId,
      messageIndex: session.send.index,
      aad,
      ivB64: iv.toString("base64"),
      ciphertextB64: ciphertext.toString("base64"),
      tagB64: tag.toString("base64"),
    };

  return {
    body,
    session: {
      ...session,
      send: {
        chainKeyB64: nextChainKey.toString("base64"),
        index: session.send.index + 1,
      },
      updatedAt: new Date().toISOString(),
    },
  };
}

export function signRatchetedBody(body, senderSigningPrivateKeyPem) {
  const privateKey = crypto.createPrivateKey(senderSigningPrivateKeyPem);
  const signature = crypto.sign(null, Buffer.from(stableStringify(body), "utf8"), privateKey);

  return stableStringify({
    version: 1,
    profile: RATCHET_PROFILE,
    body,
    signatureB64: signature.toString("base64"),
  });
}

export function sealAndSignWithSession({
  session,
  plaintext,
  aad,
  senderSigningPrivateKeyPem,
}) {
  const result = sealWithSession({
    session,
    plaintext,
    aad,
  });

  return {
    sealed: signRatchetedBody(result.body, senderSigningPrivateKeyPem),
    session: result.session,
  };
}

export function openWithSession({ session, sealed, expectedAad, senderSigningPublicKeyPem }) {
  const parsed = JSON.parse(sealed);
  const body = parsed.body;

  if (parsed.profile !== RATCHET_PROFILE || body?.profile !== RATCHET_PROFILE) {
    throw new Error("Unsupported ratchet profile");
  }

  const publicKey = crypto.createPublicKey(senderSigningPublicKeyPem);
  const signatureOk = crypto.verify(
    null,
    Buffer.from(stableStringify(body), "utf8"),
    publicKey,
    Buffer.from(parsed.signatureB64, "base64"),
  );

  if (!signatureOk) {
    throw new Error("Ratcheted payload signature verification failed");
  }

  if (body.sessionId !== session.sessionId) {
    throw new Error("Ratchet session mismatch");
  }

  if (body.messageIndex !== session.receive.index) {
    throw new Error("Unexpected ratchet message index");
  }

  if (stableStringify(body.aad) !== stableStringify(expectedAad)) {
    throw new Error("Ratchet AAD mismatch");
  }

  const chainKey = Buffer.from(session.receive.chainKeyB64, "base64");
  const { messageKey, nextChainKey } = stepChain(chainKey);
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    messageKey,
    Buffer.from(body.ivB64, "base64"),
  );

  decipher.setAAD(Buffer.from(stableStringify(body.aad), "utf8"));
  decipher.setAuthTag(Buffer.from(body.tagB64, "base64"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(body.ciphertextB64, "base64")),
    decipher.final(),
  ]);

  return {
    plaintext: JSON.parse(plaintext.toString("utf8")),
    session: {
      ...session,
      receive: {
        chainKeyB64: nextChainKey.toString("base64"),
        index: session.receive.index + 1,
      },
      updatedAt: new Date().toISOString(),
    },
  };
}
