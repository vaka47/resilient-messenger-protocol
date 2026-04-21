import {
  MAX_SMS_CONTROL_BYTES,
  PAYLOAD_TYPE,
  PRIORITY,
  TRANSPORT,
} from "./constants.js";

function scoreTransport(transport, envelope, context) {
  const scores = {
    [TRANSPORT.INTERNET_DIRECT]: 100,
    [TRANSPORT.RELAY_PRIMARY]: 85,
    [TRANSPORT.RELAY_SECONDARY]: 70,
    [TRANSPORT.NEARBY_MESH]: 60,
    [TRANSPORT.SMS_CONTROL]: 20,
  };

  let score = scores[transport] ?? 0;

  if (context.censorshipProfile === "severe") {
    if (transport === TRANSPORT.INTERNET_DIRECT) {
      score -= 30;
    }

    if (transport === TRANSPORT.RELAY_PRIMARY || transport === TRANSPORT.RELAY_SECONDARY) {
      score += 10;
    }
  }

  if (context.internetAvailable === false) {
    if (transport === TRANSPORT.INTERNET_DIRECT) {
      score = -1;
    }

    if (transport === TRANSPORT.RELAY_PRIMARY || transport === TRANSPORT.RELAY_SECONDARY) {
      score -= 20;
    }
  }

  if (context.nearbyPeersAvailable && transport === TRANSPORT.NEARBY_MESH) {
    score += 20;
  }

  if (envelope.priority === PRIORITY.URGENT && transport === TRANSPORT.SMS_CONTROL) {
    score += 30;
  }

  if (envelope.priority === PRIORITY.URGENT && transport === TRANSPORT.NEARBY_MESH) {
    score += 10;
  }

  return score;
}

function canUseSmsControl(envelope, context) {
  if (!context.smsControlAvailable) {
    return false;
  }

  if (
    envelope.payloadType !== PAYLOAD_TYPE.EMERGENCY_CONTROL &&
    envelope.payloadType !== PAYLOAD_TYPE.ACK &&
    envelope.payloadType !== PAYLOAD_TYPE.KEY_UPDATE
  ) {
    return false;
  }

  return envelope.contentBytes <= MAX_SMS_CONTROL_BYTES;
}

export function rankDeliveryPaths(envelope, context) {
  const candidates = [];

  if (context.internetAvailable) {
    candidates.push(TRANSPORT.INTERNET_DIRECT);
  }

  if (context.primaryRelayAvailable) {
    candidates.push(TRANSPORT.RELAY_PRIMARY);
  }

  if (context.secondaryRelayAvailable) {
    candidates.push(TRANSPORT.RELAY_SECONDARY);
  }

  if (context.nearbyPeersAvailable) {
    candidates.push(TRANSPORT.NEARBY_MESH);
  }

  if (canUseSmsControl(envelope, context)) {
    candidates.push(TRANSPORT.SMS_CONTROL);
  }

  return candidates
    .map((transport) => ({
      transport,
      score: scoreTransport(transport, envelope, context),
    }))
    .filter(({ score }) => score >= 0)
    .sort((left, right) => right.score - left.score);
}

export function choosePrimaryPath(envelope, context) {
  const ranked = rankDeliveryPaths(envelope, context);
  return ranked[0] ?? null;
}
