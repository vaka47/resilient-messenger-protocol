import crypto from "node:crypto";

import { PAYLOAD_TYPE, PRIORITY } from "./constants.js";

const PAYLOAD_VALUES = new Set(Object.values(PAYLOAD_TYPE));
const PRIORITY_VALUES = new Set(Object.values(PRIORITY));

function ensureString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }
}

function ensureArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an array`);
  }
}

export function estimateCiphertextBytes(ciphertext) {
  return Buffer.byteLength(ciphertext, "utf8");
}

export function createEnvelope({
  conversationId,
  senderAccountId,
  senderDeviceId,
  recipientInboxIds,
  payloadType,
  ciphertext,
  priority = PRIORITY.NORMAL,
  expiresAt = null,
  mediaRefs = [],
  deliveryHints = [],
}) {
  ensureString(conversationId, "conversationId");
  ensureString(senderAccountId, "senderAccountId");
  ensureString(senderDeviceId, "senderDeviceId");
  ensureArray(recipientInboxIds, "recipientInboxIds");
  ensureString(ciphertext, "ciphertext");
  ensureArray(mediaRefs, "mediaRefs");
  ensureArray(deliveryHints, "deliveryHints");

  if (!PAYLOAD_VALUES.has(payloadType)) {
    throw new TypeError(`payloadType must be one of ${[...PAYLOAD_VALUES].join(", ")}`);
  }

  if (!PRIORITY_VALUES.has(priority)) {
    throw new TypeError(`priority must be one of ${[...PRIORITY_VALUES].join(", ")}`);
  }

  if (recipientInboxIds.length === 0) {
    throw new TypeError("recipientInboxIds must not be empty");
  }

  const createdAt = new Date().toISOString();
  const contentBytes = estimateCiphertextBytes(ciphertext);

  return {
    version: 1,
    envelopeId: crypto.randomUUID(),
    conversationId,
    sender: {
      accountId: senderAccountId,
      deviceId: senderDeviceId,
    },
    recipients: recipientInboxIds.map((inboxId) => ({ inboxId })),
    payloadType,
    priority,
    createdAt,
    expiresAt,
    ciphertext,
    contentBytes,
    mediaRefs,
    deliveryHints,
    digest: crypto.createHash("sha256").update(ciphertext).digest("hex"),
  };
}

export function validateEnvelope(envelope) {
  if (typeof envelope !== "object" || envelope === null) {
    return { ok: false, errors: ["envelope must be an object"] };
  }

  const errors = [];

  if (envelope.version !== 1) {
    errors.push("version must be 1");
  }

  if (!PAYLOAD_VALUES.has(envelope.payloadType)) {
    errors.push("payloadType is invalid");
  }

  if (!PRIORITY_VALUES.has(envelope.priority)) {
    errors.push("priority is invalid");
  }

  if (!Array.isArray(envelope.recipients) || envelope.recipients.length === 0) {
    errors.push("recipients must be a non-empty array");
  }

  if (typeof envelope.ciphertext !== "string" || envelope.ciphertext.length === 0) {
    errors.push("ciphertext must be a non-empty string");
  }

  if (typeof envelope.contentBytes !== "number" || envelope.contentBytes <= 0) {
    errors.push("contentBytes must be a positive number");
  }

  if (typeof envelope.digest !== "string" || envelope.digest.length !== 64) {
    errors.push("digest must be a sha256 hex string");
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}
