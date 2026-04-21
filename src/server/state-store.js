import fs from "node:fs/promises";
import path from "node:path";

import { buildRelayQueueItem } from "../index.js";

function createInitialState() {
  return {
    directory: {
      accounts: {},
    },
    relay: {
      queues: {},
    },
  };
}

export class FileBackedStateStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = createInitialState();
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const existing = await fs.readFile(this.filePath, "utf8");
      this.state = JSON.parse(existing);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }

      await this.persist();
    }
  }

  async persist() {
    await fs.writeFile(this.filePath, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
  }

  async registerDevice({ accountId, displayName, device }) {
    const existing = this.state.directory.accounts[accountId] || {
      accountId,
      displayName,
      createdAt: new Date().toISOString(),
      inboxIds: [],
      devices: {},
    };

    existing.displayName = displayName;
    existing.devices[device.deviceId] = {
      ...device,
      registeredAt: new Date().toISOString(),
    };

    if (!existing.inboxIds.includes(device.inboxId)) {
      existing.inboxIds.push(device.inboxId);
    }

    this.state.directory.accounts[accountId] = existing;
    await this.persist();
    return existing;
  }

  lookupAccount(accountId) {
    return this.state.directory.accounts[accountId] || null;
  }

  async enqueueEnvelope({ envelope, recipientInboxId }) {
    const queue = this.state.relay.queues[recipientInboxId] || [];
    const item = {
      ...buildRelayQueueItem(envelope, recipientInboxId),
      envelope,
    };

    queue.push(item);
    this.state.relay.queues[recipientInboxId] = queue;
    await this.persist();
    return item;
  }

  async pullQueue(inboxId, now = Date.now()) {
    const queue = this.state.relay.queues[inboxId] || [];
    const filtered = queue.filter((item) => Date.parse(item.expiresAt) > now);

    if (filtered.length !== queue.length) {
      this.state.relay.queues[inboxId] = filtered;
      await this.persist();
    }

    return filtered.sort((left, right) => Date.parse(left.queuedAt) - Date.parse(right.queuedAt));
  }

  async ackEnvelope({ inboxId, envelopeId }) {
    const queue = this.state.relay.queues[inboxId] || [];
    const nextQueue = queue.filter((item) => item.envelopeId !== envelopeId);
    this.state.relay.queues[inboxId] = nextQueue;
    await this.persist();

    return {
      removed: queue.length - nextQueue.length,
    };
  }

  getStats() {
    const accountCount = Object.keys(this.state.directory.accounts).length;
    const queuedItems = Object.values(this.state.relay.queues).reduce(
      (sum, queue) => sum + queue.length,
      0,
    );

    return {
      accountCount,
      queuedItems,
      inboxCount: Object.keys(this.state.relay.queues).length,
    };
  }
}
