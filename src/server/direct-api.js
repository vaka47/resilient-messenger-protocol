export function createDirectApi(store) {
  return {
    async registerDevice(_, state) {
      const account = await store.registerDevice({
        accountId: state.account.accountId,
        displayName: state.account.displayName,
        device: {
          deviceId: state.device.deviceId,
          inboxId: state.device.inboxId,
          dhPublicKeyPem: state.device.dhPublicKeyPem,
          signingPublicKeyPem: state.device.signingPublicKeyPem,
          signedPreKeyId: state.device.signedPreKeyId,
          signedPreKeyPublicPem: state.device.signedPreKeyPublicPem,
          signedPreKeySignatureB64: state.device.signedPreKeySignatureB64,
          oneTimePreKeys: (state.device.oneTimePreKeys || []).map((preKey) => ({
            keyId: preKey.keyId,
            publicKeyPem: preKey.publicKeyPem,
          })),
        },
      });

      return { account };
    },

    async lookupAccount(_, accountId) {
      const account = store.lookupAccount(accountId);

      if (!account) {
        throw new Error(`Account ${accountId} not found`);
      }

      return { account };
    },

    async claimPreKey(_, accountId, deviceId) {
      const bundle = await store.claimPreKey({
        accountId,
        deviceId,
      });

      return { bundle };
    },

    async revokeDevice(_, accountId, deviceId, revokedByDeviceId = null) {
      const account = await store.revokeDevice({
        accountId,
        deviceId,
        revokedByDeviceId,
      });

      return { account };
    },

    async enqueueEnvelope(_, envelope, recipientInboxId) {
      const item = await store.enqueueEnvelope({
        envelope,
        recipientInboxId,
      });

      return { item };
    },

    async pullQueue(_, inboxId) {
      const items = await store.pullQueue(inboxId);
      return { items };
    },

    async ackEnvelope(_, inboxId, envelopeId) {
      return store.ackEnvelope({ inboxId, envelopeId });
    },

    async fetchStats() {
      return store.getStats();
    },
  };
}
