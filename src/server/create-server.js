import http from "node:http";

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function notFound(response) {
  sendJson(response, 404, {
    error: "Not found",
  });
}

export function createProtocolServer({ store }) {
  return http.createServer(async (request, response) => {
    try {
      if (!request.url) {
        notFound(response);
        return;
      }

      const url = new URL(request.url, "http://127.0.0.1");

      if (request.method === "GET" && url.pathname === "/healthz") {
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/directory/register") {
        const body = await readJsonBody(request);
        const account = await store.registerDevice(body);
        sendJson(response, 200, { account });
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/accounts/bootstrap") {
        const body = await readJsonBody(request);
        const account = await store.bootstrapAccount(body);
        sendJson(response, 200, { account });
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/invites/qr") {
        const body = await readJsonBody(request);
        const result = await store.createQrInvite(body);
        sendJson(response, 200, result);
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/accounts/complete-registration") {
        const body = await readJsonBody(request);
        const account = await store.completeRegistration(body);
        sendJson(response, 200, { account });
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/accounts/login") {
        const body = await readJsonBody(request);
        const account = store.loginByPhone(body);
        sendJson(response, 200, { account });
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/directory/revoke") {
        const body = await readJsonBody(request);
        const account = await store.revokeDevice(body);
        sendJson(response, 200, { account });
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/directory/claim-prekey") {
        const body = await readJsonBody(request);
        const bundle = await store.claimPreKey(body);
        sendJson(response, 200, { bundle });
        return;
      }

      if (request.method === "GET" && url.pathname.startsWith("/v1/directory/account/")) {
        const accountId = decodeURIComponent(url.pathname.split("/").at(-1));
        const account = store.lookupAccount(accountId);

        if (!account) {
          sendJson(response, 404, { error: `Account ${accountId} not found` });
          return;
        }

        sendJson(response, 200, { account });
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/relay/enqueue") {
        const body = await readJsonBody(request);
        const item = await store.enqueueEnvelope(body);
        sendJson(response, 202, { item });
        return;
      }

      if (request.method === "GET" && url.pathname === "/v1/relay/pull") {
        const inboxId = url.searchParams.get("inboxId");

        if (!inboxId) {
          sendJson(response, 400, { error: "Missing inboxId" });
          return;
        }

        const items = await store.pullQueue(inboxId);
        sendJson(response, 200, { items });
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/relay/ack") {
        const body = await readJsonBody(request);
        const result = await store.ackEnvelope(body);
        sendJson(response, 200, result);
        return;
      }

      if (request.method === "GET" && url.pathname === "/v1/stats") {
        sendJson(response, 200, store.getStats());
        return;
      }

      if (request.method === "GET" && url.pathname === "/v1/transparency") {
        sendJson(response, 200, store.getTransparencyLog());
        return;
      }

      notFound(response);
    } catch (error) {
      sendJson(response, 500, {
        error: error.message,
      });
    }
  });
}
