export const TRANSPORT = Object.freeze({
  INTERNET_DIRECT: "internet-direct",
  RELAY_PRIMARY: "relay-primary",
  RELAY_SECONDARY: "relay-secondary",
  NEARBY_MESH: "nearby-mesh",
  SMS_CONTROL: "sms-control",
});

export const PAYLOAD_TYPE = Object.freeze({
  MESSAGE: "message",
  ACK: "ack",
  RECEIPT: "receipt",
  MEMBERSHIP: "membership",
  KEY_UPDATE: "key_update",
  MEDIA_MANIFEST: "media_manifest",
  SYNC_OFFER: "sync_offer",
  SYNC_CHUNK: "sync_chunk",
  EMERGENCY_CONTROL: "emergency_control",
});

export const PRIORITY = Object.freeze({
  LOW: "low",
  NORMAL: "normal",
  HIGH: "high",
  URGENT: "urgent",
});

export const MAX_SMS_CONTROL_BYTES = 96;
export const DEFAULT_RELAY_TTL_MS = 1000 * 60 * 60 * 24 * 7;
