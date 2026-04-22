#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

import { fetchStats, fetchTransparencyLog, revokeDevice } from "./client/api.js";
import { computeDeviceFingerprint, verifyDeviceFingerprint } from "./client/identity.js";
import { createRecoveryBundle, openRecoveryBundle } from "./client/recovery.js";
import { registerState, sendTextMessage, syncInbox } from "./client/workflow.js";
import {
  getStateFilePath,
  initLocalState,
  linkLocalDevice,
  loadLocalState,
  saveLocalState,
} from "./client/state.js";
import { startProtocolServer } from "./server/run-server.js";
import { parseArgs, requireFlag } from "./util.js";

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printHelp() {
  process.stdout.write(`Commands:
  server --port 8080 --host 127.0.0.1 --data-file ./data/server-state.json
  init --state-dir ./state/alice --name Alice [--force]
  link-device --from-state-dir ./state/bob-phone --state-dir ./state/bob-laptop [--force]
  register --state-dir ./state/alice --base-url http://127.0.0.1:8080
  fingerprint --state-dir ./state/alice --account-id ACCOUNT_ID --device-id DEVICE_ID
  verify-device --state-dir ./state/alice --account-id ACCOUNT_ID --device-id DEVICE_ID --fingerprint FINGERPRINT
  revoke-device --state-dir ./state/bob-phone --base-url http://127.0.0.1:8080 --device-id DEVICE_ID
  send --state-dir ./state/alice --base-url http://127.0.0.1:8080 --to ACCOUNT_ID --text "hello"
  sync --state-dir ./state/bob --base-url http://127.0.0.1:8080
  inbox --state-dir ./state/bob
  stats --base-url http://127.0.0.1:8080
  transparency --base-url http://127.0.0.1:8080
  recovery-export --state-dir ./state/alice --out ./alice.recovery.json --passphrase "long passphrase"
  recovery-restore --bundle ./alice.recovery.json --state-dir ./state/alice-restored --passphrase "long passphrase" [--force]
`);
}

async function ensureRestoreTarget(stateDir, force) {
  await fs.mkdir(stateDir, { recursive: true });

  if (force) {
    return;
  }

  try {
    await fs.access(getStateFilePath(stateDir));
    throw new Error(`State already exists at ${stateDir}; rerun with --force if replacement is intended`);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));

  if (!command || command === "--help" || command === "help" || flags.help) {
    printHelp();
    return;
  }

  if (command === "server") {
    const port = Number(flags.port || 8080);
    const host = typeof flags.host === "string" ? flags.host : "127.0.0.1";
    const dataFile =
      typeof flags["data-file"] === "string"
        ? path.resolve(flags["data-file"])
        : path.resolve("data/server-state.json");

    const { baseUrl } = await startProtocolServer({ port, host, dataFile });
    process.stdout.write(`Server listening at ${baseUrl}\n`);
    return;
  }

  if (command === "init") {
    const stateDir = path.resolve(requireFlag(flags, "state-dir"));
    const displayName = requireFlag(flags, "name");
    const state = await initLocalState({
      stateDir,
      displayName,
      force: Boolean(flags.force),
    });
    printJson({
      stateDir,
      accountId: state.account.accountId,
      deviceId: state.device.deviceId,
      inboxId: state.device.inboxId,
    });
    return;
  }

  if (command === "register") {
    const stateDir = path.resolve(requireFlag(flags, "state-dir"));
    const baseUrl = requireFlag(flags, "base-url");
    const state = await loadLocalState(stateDir);
    const nextState = await registerState(baseUrl, state);
    await saveLocalState(stateDir, nextState);
    printJson({
      accountId: nextState.account.accountId,
      registeredAt: nextState.device.registeredAt,
    });
    return;
  }

  if (command === "link-device") {
    const sourceStateDir = path.resolve(requireFlag(flags, "from-state-dir"));
    const targetStateDir = path.resolve(requireFlag(flags, "state-dir"));
    const state = await linkLocalDevice({
      sourceStateDir,
      targetStateDir,
      force: Boolean(flags.force),
    });
    printJson({
      stateDir: targetStateDir,
      accountId: state.account.accountId,
      deviceId: state.device.deviceId,
      inboxId: state.device.inboxId,
    });
    return;
  }

  if (command === "revoke-device") {
    const stateDir = path.resolve(requireFlag(flags, "state-dir"));
    const baseUrl = requireFlag(flags, "base-url");
    const deviceId = requireFlag(flags, "device-id");
    const state = await loadLocalState(stateDir);
    const result = await revokeDevice(
      baseUrl,
      state.account.accountId,
      deviceId,
      state.device.deviceId,
    );
    printJson({
      accountId: result.account.accountId,
      revokedDeviceId: deviceId,
      revokedAt: result.account.devices[deviceId].revokedAt,
    });
    return;
  }

  if (command === "fingerprint") {
    const stateDir = path.resolve(requireFlag(flags, "state-dir"));
    const accountId = requireFlag(flags, "account-id");
    const deviceId = requireFlag(flags, "device-id");
    const state = await loadLocalState(stateDir);
    const accountRecord = state.directoryCache?.[accountId];
    const deviceRecord =
      accountId === state.account.accountId && deviceId === state.device.deviceId
        ? state.device
        : accountRecord?.devices?.[deviceId];

    if (!deviceRecord) {
      throw new Error(`Device ${deviceId} for account ${accountId} is not available locally`);
    }

    printJson({
      accountId,
      deviceId,
      fingerprint: computeDeviceFingerprint(accountId, deviceRecord),
    });
    return;
  }

  if (command === "verify-device") {
    const stateDir = path.resolve(requireFlag(flags, "state-dir"));
    const accountId = requireFlag(flags, "account-id");
    const deviceId = requireFlag(flags, "device-id");
    const expectedFingerprint = requireFlag(flags, "fingerprint");
    const state = await loadLocalState(stateDir);
    const nextState = verifyDeviceFingerprint({
      state,
      accountId,
      deviceId,
      expectedFingerprint,
    });
    await saveLocalState(stateDir, nextState);
    printJson({
      accountId,
      deviceId,
      verified: true,
      fingerprint: expectedFingerprint,
    });
    return;
  }

  if (command === "send") {
    const stateDir = path.resolve(requireFlag(flags, "state-dir"));
    const baseUrl = requireFlag(flags, "base-url");
    const recipientAccountId = requireFlag(flags, "to");
    const text = requireFlag(flags, "text");
    const state = await loadLocalState(stateDir);
    const result = await sendTextMessage({
      baseUrl,
      state,
      recipientAccountId,
      text,
    });
    await saveLocalState(stateDir, result.state);
    printJson({
      envelopeCount: result.envelopes.length,
      conversationId: result.conversationId,
      recipientAccountId,
    });
    return;
  }

  if (command === "sync") {
    const stateDir = path.resolve(requireFlag(flags, "state-dir"));
    const baseUrl = requireFlag(flags, "base-url");
    const state = await loadLocalState(stateDir);
    const result = await syncInbox({
      baseUrl,
      state,
    });
    await saveLocalState(stateDir, result.state);
    printJson({
      queueCount: result.queueCount,
      deliveredMessages: result.messages.length,
      messages: result.messages,
    });
    return;
  }

  if (command === "inbox") {
    const stateDir = path.resolve(requireFlag(flags, "state-dir"));
    const state = await loadLocalState(stateDir);
    printJson({
      account: state.account,
      events: state.events,
    });
    return;
  }

  if (command === "stats") {
    const baseUrl = requireFlag(flags, "base-url");
    const stats = await fetchStats(baseUrl);
    printJson(stats);
    return;
  }

  if (command === "transparency") {
    const baseUrl = requireFlag(flags, "base-url");
    const log = await fetchTransparencyLog(baseUrl);
    printJson(log);
    return;
  }

  if (command === "recovery-export") {
    const stateDir = path.resolve(requireFlag(flags, "state-dir"));
    const outFile = path.resolve(requireFlag(flags, "out"));
    const passphrase = requireFlag(flags, "passphrase");
    const state = await loadLocalState(stateDir);
    const bundle = createRecoveryBundle({
      state,
      passphrase,
    });

    await fs.mkdir(path.dirname(outFile), { recursive: true });
    await fs.writeFile(outFile, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
    printJson({
      outFile,
      accountId: bundle.accountId,
      deviceId: bundle.deviceId,
      profile: bundle.profile,
    });
    return;
  }

  if (command === "recovery-restore") {
    const bundleFile = path.resolve(requireFlag(flags, "bundle"));
    const stateDir = path.resolve(requireFlag(flags, "state-dir"));
    const passphrase = requireFlag(flags, "passphrase");
    const bundle = JSON.parse(await fs.readFile(bundleFile, "utf8"));
    const state = openRecoveryBundle({
      bundle,
      passphrase,
    });

    await ensureRestoreTarget(stateDir, Boolean(flags.force));
    await saveLocalState(stateDir, {
      ...state,
      sessions: {},
      events: [],
    });
    printJson({
      stateDir,
      accountId: state.account.accountId,
      deviceId: state.device.deviceId,
      restored: true,
    });
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
