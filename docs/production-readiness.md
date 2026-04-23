# Production Readiness

## Current Status

This repository is a production-track prototype, not an audited production messenger.

Implemented now:

- server-blind encrypted `1:1` envelopes;
- invite-only phone onboarding with sponsor approval and a 5-digit out-of-band code;
- password-protected login and linked-device registration;
- signed prekey and one-time prekey bootstrap prototype;
- per-device DH-ratcheted message chains;
- skipped-message key cache for limited out-of-order delivery;
- device fingerprint verification helpers;
- revocation enforcement in directory and relay;
- strict relay validation for active senders, active addressed recipients, and revoked devices;
- key transparency hash-chain for device registration and revocation;
- encrypted local recovery bundle for account/device key material;
- executable tests for account onboarding, password failures, delivery authorization, encryption, ratchet behavior, fanout, revocation, transparency, and recovery.

## Mobile Status

This repository is not yet a signed mobile product. It can run the protocol/server locally and has passing security tests, but the current workspace does not include a mobile app project or Android build toolchain. See `docs/mobile-runbook.md` for the minimum iOS/Android path and acceptance checklist.

## Required Before Production Security Claims

### Spec-faithful `1:1` bootstrap

Replace the current X3DH-inspired code with a selected, versioned specification target:

- X3DH for classic asynchronous setup;
- PQXDH when post-quantum hybrid bootstrap is required;
- deterministic test vectors for every DH/KEM branch;
- strict key publication and one-time prekey depletion semantics.

### Full Double Ratchet lifecycle

Replace the prototype ratchet with a complete audited state machine:

- root-key and chain-key transitions matching the spec;
- skipped-message key deletion lifecycle;
- replay, duplicate, and rollback protection;
- session corruption handling;
- deterministic import/export invariants;
- parser fuzzing for every serialized ratchet object.

### MLS groups

Group encryption must use MLS or a reviewed equivalent:

- group epochs;
- add/remove/update commits;
- external commits for resync;
- per-epoch application secrets;
- removed-member forward secrecy.

The current project only supports small group-like fanout as multiple independent `1:1` encrypted envelopes.

### Key transparency

The current transparency log detects local tampering with a linear hash chain. Production needs:

- verifiable map/tree structure;
- inclusion proofs;
- consistency proofs;
- client monitoring for unexpected device changes;
- witness or gossip support to detect split-view attacks;
- privacy review for lookup metadata.

### Recovery

The current recovery bundle is useful for local encrypted backup demos. Production needs:

- hardware-backed key storage where available;
- passphrase hardening against offline guessing;
- rate-limited remote unlock or secret sharing;
- recovery-contact or multi-device recovery UX;
- explicit stolen-device and cloned-device flows;
- independent review of backup format and migration.

### External audit

Do not claim audited security until a third party has reviewed:

- protocol specification;
- cryptographic implementation;
- mobile secure storage;
- server API and metadata leakage;
- build and dependency chain;
- recovery, revocation, and transparency UX.

## Sale-Ready Claim

Safe claim:

> This is a working reference architecture for a server-light E2EE messenger with testable resilience and security boundaries.

Unsafe claim:

> This is safer than Signal, Telegram, or WhatsApp today.

That requires audited, spec-faithful cryptographic components and production clients.
