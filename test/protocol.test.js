import test from "node:test";
import assert from "node:assert/strict";

import {
  PAYLOAD_TYPE,
  PRIORITY,
  TRANSPORT,
  buildMediaManifest,
  buildRelayQueueItem,
  choosePrimaryPath,
  createEnvelope,
  planReplication,
  rankDeliveryPaths,
  validateEnvelope,
} from "../src/index.js";

test("createEnvelope builds a valid envelope", () => {
  const envelope = createEnvelope({
    conversationId: "conv-1",
    senderAccountId: "acct-1",
    senderDeviceId: "device-1",
    recipientInboxIds: ["inbox-a"],
    payloadType: PAYLOAD_TYPE.MESSAGE,
    ciphertext: "ciphertext-body",
  });

  const validation = validateEnvelope(envelope);
  assert.equal(validation.ok, true);
  assert.equal(envelope.version, 1);
  assert.equal(envelope.recipients.length, 1);
});

test("urgent emergency control can fall back to sms control", () => {
  const envelope = createEnvelope({
    conversationId: "conv-1",
    senderAccountId: "acct-1",
    senderDeviceId: "device-1",
    recipientInboxIds: ["inbox-a"],
    payloadType: PAYLOAD_TYPE.EMERGENCY_CONTROL,
    priority: PRIORITY.URGENT,
    ciphertext: "rekey-now",
  });

  const ranked = rankDeliveryPaths(envelope, {
    internetAvailable: false,
    primaryRelayAvailable: false,
    secondaryRelayAvailable: false,
    nearbyPeersAvailable: false,
    smsControlAvailable: true,
    censorshipProfile: "severe",
  });

  assert.equal(ranked[0].transport, TRANSPORT.SMS_CONTROL);
});

test("standard messages prefer internet path when it exists", () => {
  const envelope = createEnvelope({
    conversationId: "conv-2",
    senderAccountId: "acct-1",
    senderDeviceId: "device-1",
    recipientInboxIds: ["inbox-a"],
    payloadType: PAYLOAD_TYPE.MESSAGE,
    priority: PRIORITY.NORMAL,
    ciphertext: "hello-world",
  });

  const primary = choosePrimaryPath(envelope, {
    internetAvailable: true,
    primaryRelayAvailable: true,
    secondaryRelayAvailable: true,
    nearbyPeersAvailable: true,
    smsControlAvailable: true,
    censorshipProfile: "normal",
  });

  assert.equal(primary.transport, TRANSPORT.INTERNET_DIRECT);
});

test("media manifest splits content into deterministic chunks", () => {
  const manifest = buildMediaManifest({
    mediaId: "media-1",
    sizeBytes: 150_000,
    chunkSizeBytes: 64_000,
  });

  assert.equal(manifest.chunkCount, 3);
  assert.equal(manifest.chunks[2].sizeBytes, 22_000);
});

test("replication plan keeps messages on devices and a bounded relay set", () => {
  const plan = planReplication({
    conversationId: "conv-3",
    localDeviceIds: ["phone", "laptop"],
    recipientDeviceIds: ["peer-phone"],
    trustedRelayIds: ["relay-a", "relay-b", "relay-c"],
    priority: PRIORITY.URGENT,
    mediaSizeBytes: 500_000,
  });

  assert.equal(plan.storageClass, "chunked-media");
  assert.equal(
    plan.targets.filter((target) => target.kind === "trusted-relay").length,
    2,
  );
});

test("relay queue items are temporary and carry only queue metadata", () => {
  const envelope = createEnvelope({
    conversationId: "conv-4",
    senderAccountId: "acct-1",
    senderDeviceId: "device-1",
    recipientInboxIds: ["inbox-a"],
    payloadType: PAYLOAD_TYPE.ACK,
    ciphertext: "ack:123",
  });

  const queueItem = buildRelayQueueItem(envelope, "inbox-a", Date.UTC(2026, 0, 1));
  assert.equal(queueItem.envelopeId, envelope.envelopeId);
  assert.equal(queueItem.recipientInboxId, "inbox-a");
  assert.match(queueItem.expiresAt, /^2026-01-08T00:00:00.000Z$/);
});
