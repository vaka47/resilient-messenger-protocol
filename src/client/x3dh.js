import crypto from "node:crypto";

export const X3DH_PROFILE = "RMP-X3DH-X25519-HKDFSHA256-V1";
export const X3DH_INFO = "RMP_X3DH_X25519_SHA256_V1";

function keyFromPem(pem, kind) {
  return kind === "private" ? crypto.createPrivateKey(pem) : crypto.createPublicKey(pem);
}

function diffieHellman(privateKeyPem, publicKeyPem) {
  return crypto.diffieHellman({
    privateKey: keyFromPem(privateKeyPem, "private"),
    publicKey: keyFromPem(publicKeyPem, "public"),
  });
}

function x3dhKdf(keyMaterial, info = X3DH_INFO) {
  const domainSeparator = Buffer.alloc(32, 0xff);
  const salt = Buffer.alloc(32, 0);

  return Buffer.from(
    crypto.hkdfSync(
      "sha256",
      Buffer.concat([domainSeparator, keyMaterial]),
      salt,
      Buffer.from(info, "utf8"),
      32,
    ),
  );
}

function requirePem(value, name) {
  if (typeof value !== "string" || !value.includes("-----BEGIN")) {
    throw new Error(`Missing X3DH key: ${name}`);
  }

  return value;
}

export function deriveX3dhInitiatorSecret({
  initiatorIdentityPrivateKeyPem,
  initiatorEphemeralPrivateKeyPem,
  responderIdentityPublicKeyPem,
  responderSignedPreKeyPublicKeyPem,
  responderOneTimePreKeyPublicKeyPem = null,
  info = X3DH_INFO,
}) {
  const dhOutputs = [
    diffieHellman(
      requirePem(initiatorIdentityPrivateKeyPem, "IK_A private"),
      requirePem(responderSignedPreKeyPublicKeyPem, "SPK_B public"),
    ),
    diffieHellman(
      requirePem(initiatorEphemeralPrivateKeyPem, "EK_A private"),
      requirePem(responderIdentityPublicKeyPem, "IK_B public"),
    ),
    diffieHellman(
      requirePem(initiatorEphemeralPrivateKeyPem, "EK_A private"),
      requirePem(responderSignedPreKeyPublicKeyPem, "SPK_B public"),
    ),
  ];

  if (responderOneTimePreKeyPublicKeyPem) {
    dhOutputs.push(
      diffieHellman(
        initiatorEphemeralPrivateKeyPem,
        responderOneTimePreKeyPublicKeyPem,
      ),
    );
  }

  return x3dhKdf(Buffer.concat(dhOutputs), info);
}

export function deriveX3dhResponderSecret({
  responderIdentityPrivateKeyPem,
  responderSignedPreKeyPrivateKeyPem,
  responderOneTimePreKeyPrivateKeyPem = null,
  initiatorIdentityPublicKeyPem,
  initiatorEphemeralPublicKeyPem,
  info = X3DH_INFO,
}) {
  const dhOutputs = [
    diffieHellman(
      requirePem(responderSignedPreKeyPrivateKeyPem, "SPK_B private"),
      requirePem(initiatorIdentityPublicKeyPem, "IK_A public"),
    ),
    diffieHellman(
      requirePem(responderIdentityPrivateKeyPem, "IK_B private"),
      requirePem(initiatorEphemeralPublicKeyPem, "EK_A public"),
    ),
    diffieHellman(
      responderSignedPreKeyPrivateKeyPem,
      initiatorEphemeralPublicKeyPem,
    ),
  ];

  if (responderOneTimePreKeyPrivateKeyPem) {
    dhOutputs.push(
      diffieHellman(
        responderOneTimePreKeyPrivateKeyPem,
        initiatorEphemeralPublicKeyPem,
      ),
    );
  }

  return x3dhKdf(Buffer.concat(dhOutputs), info);
}

export function deriveX3dhAssociatedData({
  initiatorIdentityPublicKeyPem,
  responderIdentityPublicKeyPem,
}) {
  return Buffer.from(
    `${requirePem(initiatorIdentityPublicKeyPem, "IK_A public")}${requirePem(
      responderIdentityPublicKeyPem,
      "IK_B public",
    )}`,
    "utf8",
  );
}

