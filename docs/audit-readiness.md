# Audit Readiness

## Purpose

This document lists the claims this prototype can support today and the evidence available in code and tests.

## Supported Prototype Claims

### Relay blindness for content

Claim:

- relay queues do not need plaintext message content.

Evidence:

- message payloads are encrypted before enqueue;
- `test/e2e.test.js` asserts that relay state does not contain plaintext message text.

### Intended-recipient access

Claim:

- ciphertext cannot be opened with the wrong recipient private key.

Evidence:

- `test/crypto.test.js` includes wrong-recipient-key rejection.

### Sender authenticity

Claim:

- encrypted payloads are signed and reject forged sender signing keys.

Evidence:

- `test/crypto.test.js` rejects forged sender signatures;
- `test/ratchet.test.js` verifies signatures over ratcheted payload bodies.

### Message-key advancement

Claim:

- prototype message chains advance after each message and can perform DH-ratchet turns on replies.

Evidence:

- `test/ratchet.test.js` checks send/receive index advancement;
- replay against an advanced receive chain is rejected.
- `test/ratchet.test.js` checks out-of-order skipped-key handling.
- `test/ratchet.test.js` checks a reply path that changes the root key through a DH-ratchet turn.

### Prekey bootstrap

Claim:

- new sessions use signed prekey bundles and consume one-time prekeys from the directory.

Evidence:

- `src/client/state.js` creates signed prekeys and one-time prekeys.
- `src/server/state-store.js` exposes `claimPreKey` and consumes one-time prekeys.
- `test/e2e.test.js` checks that one-time prekeys are consumed after first send.

### Private key locality

Claim:

- device private keys and prekey private material are not registered with the directory.

Evidence:

- `src/client/api.js` publishes only public prekey material.
- `test/e2e.test.js` checks that server state does not contain private key fields after registration.

### Device verification

Claim:

- users can compare stable device fingerprints.

Evidence:

- `test/identity.test.js` verifies fingerprint match and mismatch behavior.
- `src/cli.js` exposes `fingerprint` and `verify-device` commands for demo UX.

### Device revocation

Claim:

- revoked devices are removed from future fanout and cannot pull old queued messages.

Evidence:

- `test/e2e.test.js` covers queue purge and future fanout filtering for revoked devices.

## Not Yet Audit-Ready

The following are not production-ready and should be treated as open audit items:

- full X3DH/PQXDH prekey protocol;
- spec-faithful Double Ratchet with audited state lifecycle;
- hardened skipped-message key lifecycle;
- large-window out-of-order message delivery;
- MLS group encryption;
- key transparency;
- secure backup and recovery;
- side-channel review;
- parser fuzzing;
- independent cryptographic review.

## Reviewer Entry Points

- `src/client/crypto.js`: envelope encryption and legacy control-packet sealing.
- `src/client/ratchet.js`: prototype pairwise ratcheted message payloads.
- `src/client/identity.js`: device fingerprinting and verification state.
- `src/server/state-store.js`: directory, relay, and revocation enforcement.
- `test/`: executable security and protocol behavior checks.
