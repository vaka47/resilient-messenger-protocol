async function parseJsonResponse(response) {
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `Request failed with ${response.status}`);
  }

  return data;
}

export async function registerDevice(baseUrl, state) {
  const response = await fetch(`${baseUrl}/v1/directory/register`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      accountId: state.account.accountId,
      displayName: state.account.displayName,
      device: {
        deviceId: state.device.deviceId,
        inboxId: state.device.inboxId,
        dhPublicKeyPem: state.device.dhPublicKeyPem,
        signingPublicKeyPem: state.device.signingPublicKeyPem,
      },
    }),
  });

  return parseJsonResponse(response);
}

export async function lookupAccount(baseUrl, accountId) {
  const response = await fetch(`${baseUrl}/v1/directory/account/${accountId}`);
  return parseJsonResponse(response);
}

export async function enqueueEnvelope(baseUrl, envelope, recipientInboxId) {
  const response = await fetch(`${baseUrl}/v1/relay/enqueue`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      envelope,
      recipientInboxId,
    }),
  });

  return parseJsonResponse(response);
}

export async function pullQueue(baseUrl, inboxId) {
  const url = new URL(`${baseUrl}/v1/relay/pull`);
  url.searchParams.set("inboxId", inboxId);
  const response = await fetch(url);
  return parseJsonResponse(response);
}

export async function ackEnvelope(baseUrl, inboxId, envelopeId) {
  const response = await fetch(`${baseUrl}/v1/relay/ack`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      inboxId,
      envelopeId,
    }),
  });

  return parseJsonResponse(response);
}

export async function fetchStats(baseUrl) {
  const response = await fetch(`${baseUrl}/v1/stats`);
  return parseJsonResponse(response);
}
