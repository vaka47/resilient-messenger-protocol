import crypto from "node:crypto";

import { DEFAULT_RELAY_TTL_MS, PRIORITY } from "./constants.js";

export function buildRelayQueueItem(envelope, recipientInboxId, now = Date.now()) {
  return {
    queueItemId: crypto.randomUUID(),
    envelopeId: envelope.envelopeId,
    recipientInboxId,
    queuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + DEFAULT_RELAY_TTL_MS).toISOString(),
    priority: envelope.priority,
  };
}

export function buildMediaManifest({
  mediaId,
  sizeBytes,
  chunkSizeBytes = 64 * 1024,
  pinned = false,
}) {
  if (typeof mediaId !== "string" || mediaId.length === 0) {
    throw new TypeError("mediaId must be a non-empty string");
  }

  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    throw new TypeError("sizeBytes must be a positive integer");
  }

  if (!Number.isInteger(chunkSizeBytes) || chunkSizeBytes <= 0) {
    throw new TypeError("chunkSizeBytes must be a positive integer");
  }

  const chunkCount = Math.ceil(sizeBytes / chunkSizeBytes);
  const chunks = [];

  for (let index = 0; index < chunkCount; index += 1) {
    chunks.push({
      chunkId: `${mediaId}:${index}`,
      index,
      offset: index * chunkSizeBytes,
      sizeBytes: Math.min(chunkSizeBytes, sizeBytes - index * chunkSizeBytes),
    });
  }

  return {
    mediaId,
    sizeBytes,
    chunkSizeBytes,
    chunkCount,
    pinned,
    chunks,
  };
}

export function planReplication({
  conversationId,
  localDeviceIds,
  recipientDeviceIds,
  trustedRelayIds = [],
  priority = PRIORITY.NORMAL,
  mediaSizeBytes = 0,
}) {
  if (typeof conversationId !== "string" || conversationId.length === 0) {
    throw new TypeError("conversationId must be a non-empty string");
  }

  const targets = [
    ...localDeviceIds.map((deviceId) => ({ kind: "local-device", deviceId })),
    ...recipientDeviceIds.map((deviceId) => ({ kind: "recipient-device", deviceId })),
  ];

  const maxRelayCopies = priority === PRIORITY.URGENT ? 2 : 1;
  const selectedRelays = trustedRelayIds.slice(0, maxRelayCopies);

  for (const relayId of selectedRelays) {
    targets.push({
      kind: "trusted-relay",
      relayId,
      ttlHours: mediaSizeBytes > 0 ? 72 : 24,
    });
  }

  return {
    conversationId,
    targetCount: targets.length,
    targets,
    storageClass: mediaSizeBytes > 0 ? "chunked-media" : "message-log",
  };
}
