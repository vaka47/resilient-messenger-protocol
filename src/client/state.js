import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

function exportPem(keyObject, type) {
  return keyObject.export({ format: "pem", type }).toString();
}

function createDeviceMaterial() {
  const { publicKey: dhPublicKey, privateKey: dhPrivateKey } = crypto.generateKeyPairSync("x25519");
  const { publicKey: signingPublicKey, privateKey: signingPrivateKey } =
    crypto.generateKeyPairSync("ed25519");

  return {
    deviceId: crypto.randomUUID(),
    inboxId: crypto.randomUUID(),
    registeredAt: null,
    dhPublicKeyPem: exportPem(dhPublicKey, "spki"),
    dhPrivateKeyPem: exportPem(dhPrivateKey, "pkcs8"),
    signingPublicKeyPem: exportPem(signingPublicKey, "spki"),
    signingPrivateKeyPem: exportPem(signingPrivateKey, "pkcs8"),
  };
}

async function ensureWritableStatePath(stateDir, force) {
  if (typeof stateDir !== "string" || stateDir.length === 0) {
    throw new TypeError("stateDir must be a non-empty string");
  }

  await fs.mkdir(stateDir, { recursive: true });
  const filePath = getStateFilePath(stateDir);

  if (!force) {
    try {
      await fs.access(filePath);
      throw new Error(`State already exists at ${filePath}; rerun with force if replacement is intended`);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }
}

export async function initLocalState({ stateDir, displayName, force = false }) {
  if (typeof displayName !== "string" || displayName.trim() === "") {
    throw new TypeError("displayName must be a non-empty string");
  }

  await ensureWritableStatePath(stateDir, force);

  const state = {
    version: 1,
    account: {
      accountId: crypto.randomUUID(),
      displayName,
      createdAt: new Date().toISOString(),
    },
    device: createDeviceMaterial(),
    directoryCache: {},
    sessions: {},
    verifiedDevices: {},
    events: [],
  };

  await saveLocalState(stateDir, state);
  return state;
}

export async function linkLocalDevice({ sourceStateDir, targetStateDir, force = false }) {
  await ensureWritableStatePath(targetStateDir, force);
  const sourceState = await loadLocalState(sourceStateDir);

  const linkedState = {
    version: 1,
    account: sourceState.account,
    device: createDeviceMaterial(),
    directoryCache: sourceState.directoryCache,
    sessions: {},
    verifiedDevices: sourceState.verifiedDevices || {},
    events: [],
  };

  await saveLocalState(targetStateDir, linkedState);
  return linkedState;
}

export function getStateFilePath(stateDir) {
  return path.join(stateDir, "state.json");
}

export async function loadLocalState(stateDir) {
  const filePath = getStateFilePath(stateDir);
  const contents = await fs.readFile(filePath, "utf8");
  return JSON.parse(contents);
}

export async function saveLocalState(stateDir, state) {
  const filePath = getStateFilePath(stateDir);
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function appendEvent(state, event) {
  return {
    ...state,
    events: [...state.events, event],
  };
}

export function mergeDirectoryRecord(state, accountRecord) {
  return {
    ...state,
    directoryCache: {
      ...state.directoryCache,
      [accountRecord.accountId]: accountRecord,
    },
  };
}

export function upsertSession(state, sessionKey, session) {
  return {
    ...state,
    sessions: {
      ...(state.sessions || {}),
      [sessionKey]: session,
    },
  };
}

function aggregateDeliveryStatus(envelopes) {
  const deliveredCount = envelopes.filter((envelope) => envelope.status === "delivered").length;

  if (deliveredCount === 0) {
    return "queued";
  }

  if (deliveredCount < envelopes.length) {
    return "partially-delivered";
  }

  return "delivered";
}

export function applyDeliveryAck(state, ackPayload) {
  let changed = false;

  const nextEvents = state.events.map((event) => {
    if (event.kind !== "outbound-message" || event.messageId !== ackPayload.ackForMessageId) {
      return event;
    }

    const nextEnvelopes = event.envelopes.map((envelope) => {
      if (
        envelope.envelopeId !== ackPayload.ackForEnvelopeId &&
        envelope.recipientDeviceId !== ackPayload.recipientDeviceId
      ) {
        return envelope;
      }

      if (envelope.status === "delivered") {
        return envelope;
      }

      changed = true;
      return {
        ...envelope,
        status: "delivered",
        deliveredAt: ackPayload.deliveredAt,
      };
    });

    return {
      ...event,
      envelopes: nextEnvelopes,
      status: aggregateDeliveryStatus(nextEnvelopes),
    };
  });

  return changed
    ? {
        ...state,
        events: nextEvents,
      }
    : state;
}
