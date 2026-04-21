#!/usr/bin/env node

import path from "node:path";

import { fetchStats } from "./client/api.js";
import { registerState, sendTextMessage, syncInbox } from "./client/workflow.js";
import {
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
  send --state-dir ./state/alice --base-url http://127.0.0.1:8080 --to ACCOUNT_ID --text "hello"
  sync --state-dir ./state/bob --base-url http://127.0.0.1:8080
  inbox --state-dir ./state/bob
  stats --base-url http://127.0.0.1:8080
`);
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

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
