import fs from "node:fs/promises";
import path from "node:path";

import { buildRelayQueueItem } from "../index.js";
import {
  TRANSPARENCY_PROFILE,
  createTransparencyEntry,
  verifyTransparencyLog,
} from "./transparency.js";

function createInitialState() {
  return {
    directory: {
      accounts: {},
    },
    relay: {
      queues: {},
    },
    transparency: {
      entries: [],
    },
  };
}

function normalizeStateShape(state) {
  return {
    ...createInitialState(),
    ...state,
    directory: {
      ...createInitialState().directory,
      ...(state.directory || {}),
    },
    relay: {
      ...createInitialState().relay,
      ...(state.relay || {}),
    },
    transparency: {
      ...createInitialState().transparency,
      ...(state.transparency || {}),
    },
  };
}

function publicDeviceSnapshot(device) {
  return {
    deviceId: device.deviceId,
    inboxId: device.inboxId,
    dhPublicKeyPem: device.dhPublicKeyPem,
    signingPublicKeyPem: device.signingPublicKeyPem,
    signedPreKeyId: device.signedPreKeyId,
    signedPreKeyPublicPem: device.signedPreKeyPublicPem,
    signedPreKeySignatureB64: device.signedPreKeySignatureB64,
    oneTimePreKeyIds: (device.oneTimePreKeys || []).map((preKey) => preKey.keyId),
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
      this.state = normalizeStateShape(JSON.parse(existing));
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

    if (existing.devices[device.deviceId]?.revokedAt) {
      throw new Error(`Device ${device.deviceId} has been revoked and cannot be re-registered`);
    }

    existing.displayName = displayName;
    existing.devices[device.deviceId] = {
      ...(existing.devices[device.deviceId] || {}),
      ...device,
      registeredAt: new Date().toISOString(),
    };

    if (!existing.inboxIds.includes(device.inboxId)) {
      existing.inboxIds.push(device.inboxId);
    }

    this.state.directory.accounts[accountId] = existing;
    this.appendTransparencyEntry({
      type: "device.registered",
      accountId,
      deviceId: device.deviceId,
      payload: {
        accountId,
        displayName,
        device: publicDeviceSnapshot(existing.devices[device.deviceId]),
      },
    });
    await this.persist();
    return existing;
  }

  lookupAccount(accountId) {
    return this.state.directory.accounts[accountId] || null;
  }

  findDeviceByInbox(inboxId) {
    for (const account of Object.values(this.state.directory.accounts)) {
      for (const device of Object.values(account.devices || {})) {
        if (device.inboxId === inboxId) {
          return {
            account,
            device,
          };
        }
      }
    }

    return null;
  }

  async revokeDevice({ accountId, deviceId, revokedByDeviceId = null }) {
    const account = this.state.directory.accounts[accountId];

    if (!account?.devices?.[deviceId]) {
      throw new Error(`Device ${deviceId} for account ${accountId} not found`);
    }

    account.devices[deviceId] = {
      ...account.devices[deviceId],
      revokedAt: new Date().toISOString(),
      revokedByDeviceId,
    };

    this.appendTransparencyEntry({
      type: "device.revoked",
      accountId,
      deviceId,
      payload: {
        accountId,
        deviceId,
        revokedAt: account.devices[deviceId].revokedAt,
        revokedByDeviceId,
      },
    });
    await this.persist();
    return account;
  }

  async claimPreKey({ accountId, deviceId }) {
    const account = this.state.directory.accounts[accountId];
    const device = account?.devices?.[deviceId];

    if (!device) {
      throw new Error(`Device ${deviceId} for account ${accountId} not found`);
    }

    if (device.revokedAt) {
      throw new Error(`Device ${deviceId} has been revoked`);
    }

    const oneTimePreKey = (device.oneTimePreKeys || []).shift() || null;
    await this.persist();

    return {
      accountId,
      deviceId,
      device: {
        deviceId: device.deviceId,
        inboxId: device.inboxId,
        dhPublicKeyPem: device.dhPublicKeyPem,
        signingPublicKeyPem: device.signingPublicKeyPem,
        signedPreKeyId: device.signedPreKeyId,
        signedPreKeyPublicPem: device.signedPreKeyPublicPem,
        signedPreKeySignatureB64: device.signedPreKeySignatureB64,
      },
      signedPreKeyId: device.signedPreKeyId,
      signedPreKeyPublicPem: device.signedPreKeyPublicPem,
      signedPreKeySignatureB64: device.signedPreKeySignatureB64,
      oneTimePreKey,
    };
  }

  async enqueueEnvelope({ envelope, recipientInboxId }) {
    const recipient = this.findDeviceByInbox(recipientInboxId);

    if (recipient?.device?.revokedAt) {
      throw new Error(`Recipient inbox ${recipientInboxId} belongs to a revoked device`);
    }

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
    const recipient = this.findDeviceByInbox(inboxId);

    if (recipient?.device?.revokedAt) {
      delete this.state.relay.queues[inboxId];
      await this.persist();
      return [];
    }

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
      transparencyEntryCount: this.state.transparency?.entries?.length || 0,
    };
  }

  appendTransparencyEntry({ type, accountId, deviceId, payload }) {
    const entries = this.state.transparency?.entries || [];
    const entry = createTransparencyEntry({
      entries,
      type,
      accountId,
      deviceId,
      payload,
    });

    this.state.transparency = {
      profile: TRANSPARENCY_PROFILE,
      entries: [...entries, entry],
    };

    return entry;
  }

  getTransparencyLog() {
    const entries = this.state.transparency?.entries || [];

    return {
      profile: TRANSPARENCY_PROFILE,
      entries,
      verification: verifyTransparencyLog(entries),
    };
  }
}
