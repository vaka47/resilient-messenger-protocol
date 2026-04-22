import crypto from "node:crypto";

import { PAYLOAD_TYPE, PRIORITY, createEnvelope } from "../index.js";
import { appendEvent, applyDeliveryAck, mergeDirectoryRecord, upsertSession } from "./state.js";
import { deriveConversationId, openPayload, sealPayload } from "./crypto.js";
import {
  getOrCreatePairwiseSession,
  openWithSession,
  sealAndSignWithSession,
} from "./ratchet.js";
import {
  ackEnvelope,
  enqueueEnvelope,
  lookupAccount,
  pullQueue,
  registerDevice,
} from "./api.js";

function chooseAccountDevices(accountRecord) {
  const devices = Object.values(accountRecord.devices || {}).filter((device) => !device.revokedAt);

  if (devices.length === 0) {
    throw new Error(`Account ${accountRecord.accountId} has no active registered devices`);
  }

  return devices;
}

async function emitDeliveryAck({
  baseUrl,
  api,
  state,
  senderLookup,
  sourceEnvelope,
  payload,
}) {
  const targetDevice = senderLookup.account.devices[sourceEnvelope.sender.deviceId];

  if (!targetDevice || targetDevice.revokedAt) {
    return;
  }

  const ackPayloadType = PAYLOAD_TYPE.ACK;
  const aad = {
    conversationId: sourceEnvelope.conversationId,
    senderAccountId: state.account.accountId,
    senderDeviceId: state.device.deviceId,
    payloadType: ackPayloadType,
    recipientInboxIds: [targetDevice.inboxId],
  };

  const ciphertext = sealPayload({
    plaintext: {
      ackForEnvelopeId: sourceEnvelope.envelopeId,
      ackForMessageId: payload.messageId,
      recipientDeviceId: state.device.deviceId,
      deliveredAt: new Date().toISOString(),
    },
    aad,
    recipientDhPublicKeyPem: targetDevice.dhPublicKeyPem,
    senderSigningPrivateKeyPem: state.device.signingPrivateKeyPem,
  });

  const ackMessage = createEnvelope({
    conversationId: sourceEnvelope.conversationId,
    senderAccountId: state.account.accountId,
    senderDeviceId: state.device.deviceId,
    recipientInboxIds: [targetDevice.inboxId],
    payloadType: ackPayloadType,
    priority: PRIORITY.HIGH,
    ciphertext,
  });

  await api.enqueueEnvelope(baseUrl, ackMessage, targetDevice.inboxId);
}

export async function registerState(baseUrl, state) {
  const result = await registerDevice(baseUrl, state);
  const nextState = mergeDirectoryRecord(state, result.account);
  nextState.device = {
    ...nextState.device,
    registeredAt: result.account.devices[state.device.deviceId].registeredAt,
  };
  return nextState;
}

export async function sendTextMessage({
  baseUrl,
  state,
  recipientAccountId,
  text,
  priority = PRIORITY.NORMAL,
  api = {
    lookupAccount,
    enqueueEnvelope,
  },
}) {
  const recipient = await api.lookupAccount(baseUrl, recipientAccountId);
  const recipientDevices = chooseAccountDevices(recipient.account);
  const conversationId = deriveConversationId([state.account.accountId, recipientAccountId]);
  const payloadType = PAYLOAD_TYPE.MESSAGE;
  const messageId = crypto.randomUUID();
  const sentAt = new Date().toISOString();
  const envelopes = [];
  let workingState = mergeDirectoryRecord(state, recipient.account);

  for (const recipientDevice of recipientDevices) {
    const aad = {
      conversationId,
      senderAccountId: state.account.accountId,
      senderDeviceId: state.device.deviceId,
      payloadType,
      recipientInboxIds: [recipientDevice.inboxId],
    };

    const sessionResult = getOrCreatePairwiseSession({
      state: workingState,
      remoteAccountId: recipient.account.accountId,
      remoteDevice: recipientDevice,
    });
    workingState = sessionResult.state;

    const sealedResult = sealAndSignWithSession({
      session: sessionResult.session,
      plaintext: {
        messageId,
        text,
        sentAt,
      },
      aad,
      senderSigningPrivateKeyPem: state.device.signingPrivateKeyPem,
    });
    workingState = upsertSession(workingState, sessionResult.sessionKey, sealedResult.session);

    const envelope = createEnvelope({
      conversationId,
      senderAccountId: state.account.accountId,
      senderDeviceId: state.device.deviceId,
      recipientInboxIds: [recipientDevice.inboxId],
      payloadType,
      priority,
      ciphertext: sealedResult.sealed,
    });

    await api.enqueueEnvelope(baseUrl, envelope, recipientDevice.inboxId);
    envelopes.push({
      envelopeId: envelope.envelopeId,
      recipientDeviceId: recipientDevice.deviceId,
      recipientInboxId: recipientDevice.inboxId,
      status: "queued",
    });
  }

  const nextState = appendEvent(
    workingState,
    {
      kind: "outbound-message",
      envelopeId: envelopes[0].envelopeId,
      messageId,
      conversationId,
      recipientAccountId,
      text,
      priority,
      createdAt: sentAt,
      status: "queued",
      envelopes,
    },
  );

  return {
    state: nextState,
    envelopes,
    conversationId,
  };
}

export async function syncInbox({ baseUrl, state }) {
  return syncInboxWithApi({
    baseUrl,
    state,
  });
}

export async function syncInboxWithApi({
  baseUrl,
  state,
  api = {
    lookupAccount,
    pullQueue,
    ackEnvelope,
  },
}) {
  const queue = await api.pullQueue(baseUrl, state.device.inboxId);
  let nextState = state;
  const messages = [];

  for (const item of queue.items) {
    const senderLookup = await api.lookupAccount(baseUrl, item.envelope.sender.accountId);
    const senderDevice = senderLookup.account.devices[item.envelope.sender.deviceId];

    if (!senderDevice || senderDevice.revokedAt) {
      await api.ackEnvelope(baseUrl, state.device.inboxId, item.envelope.envelopeId);
      continue;
    }

    const expectedAad = {
      conversationId: item.envelope.conversationId,
      senderAccountId: item.envelope.sender.accountId,
      senderDeviceId: item.envelope.sender.deviceId,
      payloadType: item.envelope.payloadType,
      recipientInboxIds: item.envelope.recipients.map((recipient) => recipient.inboxId),
    };

    let payload;

    if (item.envelope.payloadType === PAYLOAD_TYPE.MESSAGE) {
      const sessionResult = getOrCreatePairwiseSession({
        state: nextState,
        remoteAccountId: senderLookup.account.accountId,
        remoteDevice: senderDevice,
      });
      nextState = sessionResult.state;

      const opened = openWithSession({
        session: sessionResult.session,
        sealed: item.envelope.ciphertext,
        expectedAad,
        senderSigningPublicKeyPem: senderDevice.signingPublicKeyPem,
      });

      nextState = upsertSession(nextState, sessionResult.sessionKey, opened.session);
      payload = opened.plaintext;
    } else {
      payload = openPayload({
        envelope: item.envelope,
        ciphertext: item.envelope.ciphertext,
        recipientDhPrivateKeyPem: state.device.dhPrivateKeyPem,
        senderSigningPublicKeyPem: senderDevice.signingPublicKeyPem,
      });
    }

    if (item.envelope.payloadType === PAYLOAD_TYPE.ACK) {
      nextState = applyDeliveryAck(nextState, payload);
      await api.ackEnvelope(baseUrl, state.device.inboxId, item.envelope.envelopeId);
      continue;
    }

    const alreadySeen = nextState.events.some(
      (event) => event.envelopeId === item.envelope.envelopeId,
    );

    if (!alreadySeen) {
      nextState = appendEvent(
        mergeDirectoryRecord(nextState, senderLookup.account),
        {
          kind: "inbound-message",
          envelopeId: item.envelope.envelopeId,
          messageId: payload.messageId,
          conversationId: item.envelope.conversationId,
          senderAccountId: item.envelope.sender.accountId,
          text: payload.text,
          receivedAt: new Date().toISOString(),
          sentAt: payload.sentAt,
        },
      );

      messages.push(payload);
    }

    await emitDeliveryAck({
      baseUrl,
      api,
      state,
      senderLookup,
      sourceEnvelope: item.envelope,
      payload,
    });

    await api.ackEnvelope(baseUrl, state.device.inboxId, item.envelope.envelopeId);
  }

  return {
    state: nextState,
    queueCount: queue.items.length,
    messages,
  };
}

export async function registerStateWithApi({ baseUrl, state, api }) {
  const result = await api.registerDevice(baseUrl, state);
  const nextState = mergeDirectoryRecord(state, result.account);
  nextState.device = {
    ...nextState.device,
    registeredAt: result.account.devices[state.device.deviceId].registeredAt,
  };
  return nextState;
}
