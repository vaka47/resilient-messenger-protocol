import crypto from "node:crypto";

import { stableStringify } from "../util.js";

export const RATCHET_PROFILE = "RMP-PROTOTYPE-DH-RATCHET-V2";

const ROOT_INFO = Buffer.from("rmp-root-v2", "utf8");
const CHAIN_INFO = Buffer.from("rmp-chain-v2", "utf8");
const MESSAGE_INFO = Buffer.from("rmp-message-v2", "utf8");
const DH_RATCHET_INFO = Buffer.from("rmp-dh-ratchet-v2", "utf8");
const MAX_SKIP = 50;

function exportPem(keyObject, type) {
  return keyObject.export({ format: "pem", type }).toString();
}

function generateX25519KeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519");

  return {
    publicKeyPem: exportPem(publicKey, "spki"),
    privateKeyPem: exportPem(privateKey, "pkcs8"),
  };
}

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

function diffieHellman(privateKeyPem, publicKeyPem) {
  const { privateKey } = createKeyObjectsFromPem({ privateKeyPem });
  const { publicKey } = createKeyObjectsFromPem({ publicKeyPem });

  return crypto.diffieHellman({
    privateKey,
    publicKey,
  });
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

function keyDigest(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function skippedKeyId(ratchetPublicKeyPem, messageIndex) {
  return `${keyDigest(ratchetPublicKeyPem)}:${messageIndex}`;
}

function concatSecrets(secrets) {
  return Buffer.concat(secrets.filter(Boolean));
}

function findLocalOneTimePreKey(localDevice, keyId) {
  if (!keyId) {
    return null;
  }

  return (localDevice.oneTimePreKeys || []).find((preKey) => preKey.keyId === keyId) || null;
}

function deriveInitialRootKey({
  role,
  localDevice,
  remoteDevice,
  remotePreKeyBundle = null,
  inboundHeader = null,
}) {
  if (role === "initiator") {
    const secrets = [
      diffieHellman(localDevice.dhPrivateKeyPem, remoteDevice.dhPublicKeyPem),
    ];

    if (remotePreKeyBundle?.signedPreKeyPublicPem) {
      secrets.push(diffieHellman(localDevice.dhPrivateKeyPem, remotePreKeyBundle.signedPreKeyPublicPem));
    }

    if (remotePreKeyBundle?.oneTimePreKey?.publicKeyPem) {
      secrets.push(diffieHellman(localDevice.dhPrivateKeyPem, remotePreKeyBundle.oneTimePreKey.publicKeyPem));
    }

    return hkdf(
      concatSecrets(secrets),
      Buffer.from(canonicalPair(localDevice.deviceId, remoteDevice.deviceId), "utf8"),
      ROOT_INFO,
    );
  }

  const secrets = [
    diffieHellman(localDevice.dhPrivateKeyPem, remoteDevice.dhPublicKeyPem),
  ];

  if (inboundHeader?.recipientSignedPreKeyId && localDevice.signedPreKeyPrivatePem) {
    secrets.push(diffieHellman(localDevice.signedPreKeyPrivatePem, remoteDevice.dhPublicKeyPem));
  }

  const oneTimePreKey = findLocalOneTimePreKey(
    localDevice,
    inboundHeader?.recipientOneTimePreKeyId,
  );

  if (oneTimePreKey?.privateKeyPem) {
    secrets.push(diffieHellman(oneTimePreKey.privateKeyPem, remoteDevice.dhPublicKeyPem));
  }

  return hkdf(
    concatSecrets(secrets),
    Buffer.from(canonicalPair(localDevice.deviceId, remoteDevice.deviceId), "utf8"),
    ROOT_INFO,
  );
}

function deriveInitialChainKey(rootKey, senderDeviceId, recipientDeviceId) {
  return hkdf(
    rootKey,
    Buffer.from(directionLabel(senderDeviceId, recipientDeviceId), "utf8"),
    CHAIN_INFO,
  );
}

function deriveDhRatchetStep(rootKey, dhSecret, label) {
  const material = hkdf(
    concatSecrets([rootKey, dhSecret]),
    Buffer.from(label, "utf8"),
    DH_RATCHET_INFO,
    64,
  );

  return {
    rootKey: material.subarray(0, 32),
    chainKey: material.subarray(32, 64),
  };
}

function stepChain(chainKey) {
  return {
    messageKey: hmac(chainKey, MESSAGE_INFO),
    nextChainKey: hmac(chainKey, CHAIN_INFO),
  };
}

function verifySignedPreKey(remoteDevice, remotePreKeyBundle) {
  if (!remotePreKeyBundle?.signedPreKeyPublicPem) {
    return;
  }

  const publicKey = crypto.createPublicKey(remoteDevice.signingPublicKeyPem);
  const payload = stableStringify({
    deviceId: remoteDevice.deviceId,
    signedPreKeyId: remotePreKeyBundle.signedPreKeyId,
    signedPreKeyPublicPem: remotePreKeyBundle.signedPreKeyPublicPem,
  });
  const ok = crypto.verify(
    null,
    Buffer.from(payload, "utf8"),
    publicKey,
    Buffer.from(remotePreKeyBundle.signedPreKeySignatureB64, "base64"),
  );

  if (!ok) {
    throw new Error("Remote signed prekey verification failed");
  }
}

export function readRatchetedHeader(sealed) {
  const parsed = JSON.parse(sealed);

  if (parsed.profile !== RATCHET_PROFILE || parsed.body?.profile !== RATCHET_PROFILE) {
    throw new Error("Unsupported ratchet profile");
  }

  return {
    sessionId: parsed.body.sessionId,
    senderDeviceId: parsed.body.senderDeviceId,
    recipientDeviceId: parsed.body.recipientDeviceId,
    senderRatchetPublicKeyPem: parsed.body.senderRatchetPublicKeyPem,
    messageIndex: parsed.body.messageIndex,
    recipientSignedPreKeyId: parsed.body.bootstrap?.recipientSignedPreKeyId || null,
    recipientOneTimePreKeyId: parsed.body.bootstrap?.recipientOneTimePreKeyId || null,
  };
}

export function createPairwiseSession({
  localDevice,
  remoteDevice,
  localAccountId,
  remoteAccountId,
  role = "initiator",
  remotePreKeyBundle = null,
  inboundHeader = null,
}) {
  if (role === "initiator") {
    verifySignedPreKey(remoteDevice, remotePreKeyBundle);
  }

  const rootKey = deriveInitialRootKey({
    role,
    localDevice,
    remoteDevice,
    remotePreKeyBundle,
    inboundHeader,
  });
  const ownRatchet = generateX25519KeyPair();

  return {
    version: 2,
    profile: RATCHET_PROFILE,
    sessionId: sessionIdFor(localDevice.deviceId, remoteDevice.deviceId),
    localAccountId,
    localDeviceId: localDevice.deviceId,
    remoteAccountId,
    remoteDeviceId: remoteDevice.deviceId,
    rootKeyB64: rootKey.toString("base64"),
    rootKeyDigest: crypto.createHash("sha256").update(rootKey).digest("hex"),
    dh: {
      ownPrivateKeyPem: ownRatchet.privateKeyPem,
      ownPublicKeyPem: ownRatchet.publicKeyPem,
      remotePublicKeyPem: null,
    },
    send: {
      chainKeyB64: deriveInitialChainKey(
        rootKey,
        localDevice.deviceId,
        remoteDevice.deviceId,
      ).toString("base64"),
      index: 0,
    },
    receive: {
      chainKeyB64: deriveInitialChainKey(
        rootKey,
        remoteDevice.deviceId,
        localDevice.deviceId,
      ).toString("base64"),
      index: 0,
    },
    skippedMessageKeys: {},
    bootstrap: {
      role,
      recipientSignedPreKeyId:
        role === "initiator" ? remotePreKeyBundle?.signedPreKeyId || null : inboundHeader?.recipientSignedPreKeyId || null,
      recipientOneTimePreKeyId:
        role === "initiator"
          ? remotePreKeyBundle?.oneTimePreKey?.keyId || null
          : inboundHeader?.recipientOneTimePreKeyId || null,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function getSessionKey(localDeviceId, remoteDeviceId) {
  return `${localDeviceId}:${remoteDeviceId}`;
}

export function getOrCreatePairwiseSession({
  state,
  remoteAccountId,
  remoteDevice,
  role = "initiator",
  remotePreKeyBundle = null,
  inboundHeader = null,
}) {
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
    localDevice: state.device,
    remoteDevice,
    localAccountId: state.account.accountId,
    remoteAccountId,
    role,
    remotePreKeyBundle,
    inboundHeader,
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
    version: 2,
    profile: RATCHET_PROFILE,
    sessionId: session.sessionId,
    senderDeviceId: session.localDeviceId,
    recipientDeviceId: session.remoteDeviceId,
    senderRatchetPublicKeyPem: session.dh.ownPublicKeyPem,
    messageIndex: session.send.index,
    bootstrap: {
      recipientSignedPreKeyId: session.bootstrap?.recipientSignedPreKeyId || null,
      recipientOneTimePreKeyId: session.bootstrap?.recipientOneTimePreKeyId || null,
    },
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
    version: 2,
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

function storeSkippedKeysUntil({ session, untilIndex }) {
  let receive = {
    ...session.receive,
  };
  let skippedMessageKeys = {
    ...(session.skippedMessageKeys || {}),
  };

  if (untilIndex - receive.index > MAX_SKIP) {
    throw new Error("Too many skipped ratchet message keys");
  }

  while (receive.index < untilIndex) {
    const chainKey = Buffer.from(receive.chainKeyB64, "base64");
    const { messageKey, nextChainKey } = stepChain(chainKey);
    skippedMessageKeys[skippedKeyId(session.dh.remotePublicKeyPem, receive.index)] =
      messageKey.toString("base64");
    receive = {
      chainKeyB64: nextChainKey.toString("base64"),
      index: receive.index + 1,
    };
  }

  return {
    ...session,
    receive,
    skippedMessageKeys,
  };
}

function maybeAdvanceDhRatchet(session, senderRatchetPublicKeyPem) {
  if (!senderRatchetPublicKeyPem) {
    return session;
  }

  if (session.dh.remotePublicKeyPem === senderRatchetPublicKeyPem) {
    return session;
  }

  if (!session.dh.remotePublicKeyPem && session.receive.index === 0) {
    const rootKey = Buffer.from(session.rootKeyB64, "base64");

    if (session.bootstrap?.role === "initiator") {
      const receiveStep = deriveDhRatchetStep(
        rootKey,
        diffieHellman(session.dh.ownPrivateKeyPem, senderRatchetPublicKeyPem),
        directionLabel(session.remoteDeviceId, session.localDeviceId),
      );
      const newOwnRatchet = generateX25519KeyPair();
      const sendStep = deriveDhRatchetStep(
        receiveStep.rootKey,
        diffieHellman(newOwnRatchet.privateKeyPem, senderRatchetPublicKeyPem),
        directionLabel(session.localDeviceId, session.remoteDeviceId),
      );

      return {
        ...session,
        rootKeyB64: sendStep.rootKey.toString("base64"),
        rootKeyDigest: crypto.createHash("sha256").update(sendStep.rootKey).digest("hex"),
        dh: {
          ownPrivateKeyPem: newOwnRatchet.privateKeyPem,
          ownPublicKeyPem: newOwnRatchet.publicKeyPem,
          remotePublicKeyPem: senderRatchetPublicKeyPem,
        },
        send: {
          chainKeyB64: sendStep.chainKey.toString("base64"),
          index: 0,
        },
        receive: {
          chainKeyB64: receiveStep.chainKey.toString("base64"),
          index: 0,
        },
      };
    }

    const sendStep = deriveDhRatchetStep(
      rootKey,
      diffieHellman(session.dh.ownPrivateKeyPem, senderRatchetPublicKeyPem),
      directionLabel(session.localDeviceId, session.remoteDeviceId),
    );

    return {
      ...session,
      rootKeyB64: sendStep.rootKey.toString("base64"),
      rootKeyDigest: crypto.createHash("sha256").update(sendStep.rootKey).digest("hex"),
      dh: {
        ...session.dh,
        remotePublicKeyPem: senderRatchetPublicKeyPem,
      },
      send: {
        chainKeyB64: sendStep.chainKey.toString("base64"),
        index: 0,
      },
    };
  }

  const receiveStep = deriveDhRatchetStep(
    Buffer.from(session.rootKeyB64, "base64"),
    diffieHellman(session.dh.ownPrivateKeyPem, senderRatchetPublicKeyPem),
    directionLabel(session.remoteDeviceId, session.localDeviceId),
  );
  const newOwnRatchet = generateX25519KeyPair();
  const sendStep = deriveDhRatchetStep(
    receiveStep.rootKey,
    diffieHellman(newOwnRatchet.privateKeyPem, senderRatchetPublicKeyPem),
    directionLabel(session.localDeviceId, session.remoteDeviceId),
  );

  return {
    ...session,
    rootKeyB64: sendStep.rootKey.toString("base64"),
    rootKeyDigest: crypto.createHash("sha256").update(sendStep.rootKey).digest("hex"),
    dh: {
      ownPrivateKeyPem: newOwnRatchet.privateKeyPem,
      ownPublicKeyPem: newOwnRatchet.publicKeyPem,
      remotePublicKeyPem: senderRatchetPublicKeyPem,
    },
    send: {
      chainKeyB64: sendStep.chainKey.toString("base64"),
      index: 0,
    },
    receive: {
      chainKeyB64: receiveStep.chainKey.toString("base64"),
      index: 0,
    },
    skippedMessageKeys: {},
  };
}

function decryptWithMessageKey({ messageKey, body }) {
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

  return JSON.parse(plaintext.toString("utf8"));
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

  if (stableStringify(body.aad) !== stableStringify(expectedAad)) {
    throw new Error("Ratchet AAD mismatch");
  }

  let workingSession = maybeAdvanceDhRatchet(session, body.senderRatchetPublicKeyPem);
  const skippedId = skippedKeyId(body.senderRatchetPublicKeyPem, body.messageIndex);
  const skippedMessageKeyB64 = workingSession.skippedMessageKeys?.[skippedId];

  if (skippedMessageKeyB64) {
    const skippedMessageKeys = {
      ...workingSession.skippedMessageKeys,
    };
    delete skippedMessageKeys[skippedId];

    return {
      plaintext: decryptWithMessageKey({
        messageKey: Buffer.from(skippedMessageKeyB64, "base64"),
        body,
      }),
      session: {
        ...workingSession,
        skippedMessageKeys,
        updatedAt: new Date().toISOString(),
      },
    };
  }

  if (body.messageIndex < workingSession.receive.index) {
    throw new Error("Unexpected ratchet message index");
  }

  workingSession = storeSkippedKeysUntil({
    session: workingSession,
    untilIndex: body.messageIndex,
  });

  const chainKey = Buffer.from(workingSession.receive.chainKeyB64, "base64");
  const { messageKey, nextChainKey } = stepChain(chainKey);

  return {
    plaintext: decryptWithMessageKey({
      messageKey,
      body,
    }),
    session: {
      ...workingSession,
      receive: {
        chainKeyB64: nextChainKey.toString("base64"),
        index: workingSession.receive.index + 1,
      },
      updatedAt: new Date().toISOString(),
    },
  };
}
