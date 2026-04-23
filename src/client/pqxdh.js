import crypto from "node:crypto";

export const PQXDH_PROFILE = "RMP-PQXDH-ADAPTER-V1";
export const PQXDH_REQUIRED_KEM = "ML-KEM";

function hkdf(inputKeyMaterial, info) {
  return Buffer.from(
    crypto.hkdfSync(
      "sha256",
      inputKeyMaterial,
      Buffer.alloc(32, 0),
      Buffer.from(info, "utf8"),
      32,
    ),
  );
}

export function assertPqxdhKemProvider(provider) {
  if (
    !provider ||
    typeof provider.encapsulate !== "function" ||
    typeof provider.decapsulate !== "function" ||
    typeof provider.name !== "string"
  ) {
    throw new Error(
      "PQXDH requires an audited KEM provider; refusing to silently downgrade to classical X3DH",
    );
  }
}

export function combinePqxdhSharedSecret({
  x3dhSharedSecret,
  kemSharedSecret,
  kemName = PQXDH_REQUIRED_KEM,
}) {
  if (!Buffer.isBuffer(x3dhSharedSecret) || !Buffer.isBuffer(kemSharedSecret)) {
    throw new TypeError("PQXDH combiner expects Buffer shared secrets");
  }

  return hkdf(
    Buffer.concat([x3dhSharedSecret, kemSharedSecret]),
    `${PQXDH_PROFILE}:${kemName}`,
  );
}

export function encapsulatePqxdhSecret({
  provider,
  x3dhSharedSecret,
  remoteKemPublicKey,
}) {
  assertPqxdhKemProvider(provider);
  const encapsulation = provider.encapsulate(remoteKemPublicKey);

  if (!Buffer.isBuffer(encapsulation.sharedSecret)) {
    throw new Error("PQXDH KEM provider returned an invalid sharedSecret");
  }

  return {
    profile: PQXDH_PROFILE,
    kemName: provider.name,
    ciphertext: encapsulation.ciphertext,
    sharedSecret: combinePqxdhSharedSecret({
      x3dhSharedSecret,
      kemSharedSecret: encapsulation.sharedSecret,
      kemName: provider.name,
    }),
  };
}

export function decapsulatePqxdhSecret({
  provider,
  x3dhSharedSecret,
  localKemPrivateKey,
  ciphertext,
}) {
  assertPqxdhKemProvider(provider);
  const kemSharedSecret = provider.decapsulate({
    privateKey: localKemPrivateKey,
    ciphertext,
  });

  if (!Buffer.isBuffer(kemSharedSecret)) {
    throw new Error("PQXDH KEM provider returned an invalid decapsulation secret");
  }

  return {
    profile: PQXDH_PROFILE,
    kemName: provider.name,
    sharedSecret: combinePqxdhSharedSecret({
      x3dhSharedSecret,
      kemSharedSecret,
      kemName: provider.name,
    }),
  };
}

