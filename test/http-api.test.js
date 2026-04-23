import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { initLocalState } from "../src/client/state.js";
import { createProtocolServer } from "../src/server/create-server.js";
import { FileBackedStateStore } from "../src/server/state-store.js";

async function postJson(server, pathname, body) {
  const listener = server.listeners("request")[0];
  const request = Readable.from([Buffer.from(JSON.stringify(body), "utf8")]);
  request.method = "POST";
  request.url = pathname;

  const response = {
    statusCode: null,
    headers: null,
    payload: "",
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(chunk) {
      this.payload += chunk || "";
      this.resolve();
    },
  };

  const finished = new Promise((resolve) => {
    response.resolve = resolve;
  });

  await listener(request, response);
  await finished;

  const data = JSON.parse(response.payload);

  if (response.statusCode >= 400) {
    throw new Error(data.error || `HTTP ${response.statusCode}`);
  }

  return data;
}

function publicDevicePayload(state) {
  return {
    deviceId: state.device.deviceId,
    inboxId: state.device.inboxId,
    dhPublicKeyPem: state.device.dhPublicKeyPem,
    signingPublicKeyPem: state.device.signingPublicKeyPem,
    signedPreKeyId: state.device.signedPreKeyId,
    signedPreKeyPublicPem: state.device.signedPreKeyPublicPem,
    signedPreKeySignatureB64: state.device.signedPreKeySignatureB64,
    oneTimePreKeys: state.device.oneTimePreKeys.map((preKey) => ({
      keyId: preKey.keyId,
      publicKeyPem: preKey.publicKeyPem,
    })),
  };
}

test("HTTP account endpoints support owner bootstrap and sponsor-approved registration", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rmp-http-"));
  const store = new FileBackedStateStore(path.join(tmpRoot, "server-state.json"));
  await store.init();
  const server = createProtocolServer({ store });

  const alice = await initLocalState({
    stateDir: path.join(tmpRoot, "alice"),
    displayName: "Alice",
  });
  const bob = await initLocalState({
    stateDir: path.join(tmpRoot, "bob"),
    displayName: "Bob",
  });

  const owner = await postJson(server, "/v1/accounts/bootstrap", {
    accountId: alice.account.accountId,
    displayName: alice.account.displayName,
    phone: "+10000003001",
    password: "alice-password-123",
    passwordConfirm: "alice-password-123",
    device: publicDevicePayload(alice),
  });
  assert.equal(owner.account.phone, "+10000003001");

  const invite = await postJson(server, "/v1/invites/qr", {
    phone: "+10000003002",
    sponsorAccountId: owner.account.accountId,
  });
  assert.equal(invite.qrPayload.type, "rmp.qr-invite.v1");
  assert.equal("qrTokenRecord" in invite.request, false);

  const registration = await postJson(server, "/v1/accounts/complete-registration", {
    requestId: invite.request.requestId,
    qrToken: invite.qrToken,
    accountId: bob.account.accountId,
    displayName: bob.account.displayName,
    phone: "+10000003002",
    password: "bob-password-123",
    passwordConfirm: "bob-password-123",
    device: publicDevicePayload(bob),
  });
  assert.equal(registration.account.invitedByAccountId, alice.account.accountId);

  await assert.rejects(
    postJson(server, "/v1/accounts/login", {
      phone: "+10000003002",
      password: "wrong-password-123",
    }),
    /invalid phone or password/,
  );

  const login = await postJson(server, "/v1/accounts/login", {
    phone: "+10000003002",
    password: "bob-password-123",
  });
  assert.equal(login.account.accountId, bob.account.accountId);
  assert.equal("passwordRecord" in login.account, false);
});
