import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { buildRelayQueueItem, validateEnvelope } from "../index.js";
import {
  TRANSPARENCY_PROFILE,
  createTransparencyEntry,
  verifyTransparencyLog,
} from "./transparency.js";
import {
  assertPasswordConfirmed,
  createInviteCode,
  createInviteCodeRecord,
  createPasswordRecord,
  normalizePhone,
  verifyInviteCode,
  verifyPassword,
} from "./auth.js";

function createInitialState() {
  return {
    directory: {
      accounts: {},
      phoneIndex: {},
      inviteRequests: {},
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
    revokedAt: device.revokedAt || null,
    revokedByDeviceId: device.revokedByDeviceId || null,
    dhPublicKeyPem: device.dhPublicKeyPem,
    signingPublicKeyPem: device.signingPublicKeyPem,
    signedPreKeyId: device.signedPreKeyId,
    signedPreKeyPublicPem: device.signedPreKeyPublicPem,
    signedPreKeySignatureB64: device.signedPreKeySignatureB64,
    oneTimePreKeyIds: (device.oneTimePreKeys || []).map((preKey) => preKey.keyId),
  };
}

function publicAccountRecord(account) {
  if (!account) {
    return null;
  }

  return {
    accountId: account.accountId,
    displayName: account.displayName,
    phone: account.phone,
    status: account.status,
    createdAt: account.createdAt,
    approvedAt: account.approvedAt,
    invitedByAccountId: account.invitedByAccountId || null,
    inboxIds: account.inboxIds || [],
    devices: Object.fromEntries(
      Object.entries(account.devices || {}).map(([deviceId, device]) => [
        deviceId,
        publicDeviceSnapshot(device),
      ]),
    ),
  };
}

function publicInviteRequestRecord(request) {
  if (!request) {
    return null;
  }

  return {
    requestId: request.requestId,
    phone: request.phone,
    sponsorAccountId: request.sponsorAccountId,
    status: request.status,
    createdAt: request.createdAt,
    expiresAt: request.expiresAt,
    approvedAt: request.approvedAt || null,
    usedAt: request.usedAt || null,
    inviteeAccountId: request.inviteeAccountId || null,
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

  assertActiveAccount(accountId) {
    const account = this.state.directory.accounts[accountId];

    if (!account || account.status !== "active") {
      throw new Error(`Account ${accountId} is not active`);
    }

    return account;
  }

  async bootstrapAccount({ accountId, displayName, phone, password, passwordConfirm, device }) {
    if (Object.keys(this.state.directory.accounts).length > 0) {
      throw new Error("bootstrap is allowed only for the first account");
    }

    assertPasswordConfirmed(password, passwordConfirm);
    const normalizedPhone = normalizePhone(phone);
    const account = {
      accountId,
      displayName,
      phone: normalizedPhone,
      status: "active",
      createdAt: new Date().toISOString(),
      approvedAt: new Date().toISOString(),
      invitedByAccountId: null,
      passwordRecord: createPasswordRecord(password),
      inboxIds: [],
      devices: {},
    };

    this.state.directory.accounts[accountId] = account;
    this.state.directory.phoneIndex[normalizedPhone] = accountId;
    await this.addDeviceToActiveAccount({
      account,
      displayName,
      device,
      eventType: "account.bootstrap",
    });
    return publicAccountRecord(this.state.directory.accounts[accountId]);
  }

  async registerDevice({ accountId, displayName, password, device }) {
    const existing = this.assertActiveAccount(accountId);

    if (!verifyPassword(password, existing.passwordRecord)) {
      throw new Error("invalid account password");
    }

    return this.addDeviceToActiveAccount({
      account: existing,
      displayName,
      device,
      eventType: "device.registered",
    });
  }

  async addDeviceToActiveAccount({ account, displayName, device, eventType }) {
    const existing = account;

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

    this.state.directory.accounts[existing.accountId] = existing;
    this.appendTransparencyEntry({
      type: eventType,
      accountId: existing.accountId,
      deviceId: device.deviceId,
      payload: {
        accountId: existing.accountId,
        displayName,
        device: publicDeviceSnapshot(existing.devices[device.deviceId]),
      },
    });
    await this.persist();
    return publicAccountRecord(existing);
  }

  async requestInvite({ phone, sponsorPhone }) {
    const normalizedPhone = normalizePhone(phone);
    const normalizedSponsorPhone = normalizePhone(sponsorPhone);
    const sponsorAccountId = this.state.directory.phoneIndex[normalizedSponsorPhone];
    const sponsor = sponsorAccountId ? this.assertActiveAccount(sponsorAccountId) : null;

    if (!sponsor) {
      throw new Error("sponsor phone is not registered");
    }

    if (this.state.directory.phoneIndex[normalizedPhone]) {
      throw new Error("phone is already registered");
    }

    const activeRequest = Object.values(this.state.directory.inviteRequests).find(
      (request) =>
        request.phone === normalizedPhone &&
        ["pending", "approved"].includes(request.status) &&
        Date.parse(request.expiresAt) > Date.now(),
    );

    if (activeRequest) {
      throw new Error("phone already has an active invite request");
    }

    const requestId = crypto.randomUUID();
    const request = {
      requestId,
      phone: normalizedPhone,
      sponsorAccountId,
      status: "pending",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 1000 * 60 * 15).toISOString(),
    };

    this.state.directory.inviteRequests[requestId] = request;
    await this.persist();
    return publicInviteRequestRecord(request);
  }

  async approveInvite({ sponsorAccountId, requestId }) {
    const sponsor = this.assertActiveAccount(sponsorAccountId);
    const request = this.state.directory.inviteRequests[requestId];

    if (!request) {
      throw new Error(`Invite request ${requestId} not found`);
    }

    if (request.sponsorAccountId !== sponsor.accountId) {
      throw new Error("invite request does not belong to this sponsor");
    }

    if (request.status !== "pending") {
      throw new Error(`invite request is not pending: ${request.status}`);
    }

    if (Date.parse(request.expiresAt) <= Date.now()) {
      throw new Error("invite request expired");
    }

    const code = createInviteCode();
    request.status = "approved";
    request.approvedAt = new Date().toISOString();
    request.codeRecord = createInviteCodeRecord(code);
    await this.persist();

    return {
      request: publicInviteRequestRecord(request),
      code,
    };
  }

  async completeRegistration({
    requestId,
    code,
    accountId,
    displayName,
    phone,
    password,
    passwordConfirm,
    device,
  }) {
    const request = this.state.directory.inviteRequests[requestId];

    if (!request || request.status !== "approved") {
      throw new Error("invite request is not approved");
    }

    if (Date.parse(request.expiresAt) <= Date.now()) {
      throw new Error("invite request expired");
    }

    const normalizedPhone = normalizePhone(phone);

    if (normalizedPhone !== request.phone) {
      throw new Error("phone does not match invite request");
    }

    if (!verifyInviteCode(code, request.codeRecord)) {
      throw new Error("invalid invite code");
    }

    if (this.state.directory.phoneIndex[normalizedPhone]) {
      throw new Error("phone is already registered");
    }

    if (this.state.directory.accounts[accountId]) {
      throw new Error("account is already registered");
    }

    assertPasswordConfirmed(password, passwordConfirm);

    const account = {
      accountId,
      displayName,
      phone: normalizedPhone,
      status: "active",
      createdAt: new Date().toISOString(),
      approvedAt: new Date().toISOString(),
      invitedByAccountId: request.sponsorAccountId,
      passwordRecord: createPasswordRecord(password),
      inboxIds: [],
      devices: {},
    };

    this.state.directory.accounts[accountId] = account;
    this.state.directory.phoneIndex[normalizedPhone] = accountId;
    request.status = "used";
    request.usedAt = new Date().toISOString();
    request.inviteeAccountId = accountId;

    await this.addDeviceToActiveAccount({
      account,
      displayName,
      device,
      eventType: "account.invited",
    });
    return publicAccountRecord(this.state.directory.accounts[accountId]);
  }

  loginByPhone({ phone, password }) {
    const normalizedPhone = normalizePhone(phone);
    const accountId = this.state.directory.phoneIndex[normalizedPhone];
    const account = accountId ? this.state.directory.accounts[accountId] : null;

    if (!account || account.status !== "active" || !verifyPassword(password, account.passwordRecord)) {
      throw new Error("invalid phone or password");
    }

    return publicAccountRecord(account);
  }

  lookupAccount(accountId) {
    return publicAccountRecord(this.state.directory.accounts[accountId] || null);
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

  findAccountDevice({ accountId, deviceId }) {
    const account = this.state.directory.accounts[accountId];
    const device = account?.devices?.[deviceId] || null;

    if (!account || !device) {
      return null;
    }

    return {
      account,
      device,
    };
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
    const validation = validateEnvelope(envelope);

    if (!validation.ok) {
      throw new Error(`Invalid envelope: ${validation.errors.join(", ")}`);
    }

    const addressedInboxes = (envelope.recipients || []).map((entry) => entry.inboxId);

    if (!addressedInboxes.includes(recipientInboxId)) {
      throw new Error(`Recipient inbox ${recipientInboxId} is not addressed by this envelope`);
    }

    const sender = this.findAccountDevice({
      accountId: envelope.sender?.accountId,
      deviceId: envelope.sender?.deviceId,
    });

    if (!sender || sender.account.status !== "active" || sender.device.revokedAt) {
      throw new Error("Envelope sender is not an active registered device");
    }

    const recipient = this.findDeviceByInbox(recipientInboxId);

    if (!recipient || recipient.account.status !== "active") {
      throw new Error(`Recipient inbox ${recipientInboxId} is not an active registered device`);
    }

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
