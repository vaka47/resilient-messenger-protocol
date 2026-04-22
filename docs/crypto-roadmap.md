# Crypto Roadmap

## Current Prototype

Current envelope sealing uses standard Node.js cryptographic primitives:

- X25519 ephemeral-static Diffie-Hellman;
- HKDF-SHA256 key derivation;
- AES-256-GCM authenticated encryption;
- Ed25519 sender signatures.

Current message payload delivery now additionally includes:

- signed prekey bundles;
- one-time prekey directory consumption;
- per-device pairwise session derivation from X25519;
- directional chain keys;
- DH-ratchet turns when a peer replies with a new ratchet public key;
- one message key per outbound message;
- ratchet index enforcement to reject replay against advanced state;
- skipped-message key cache for limited out-of-order delivery;
- Ed25519 signatures over ratcheted payload bodies.
- append-only key transparency hash-chain entries for device registration and revocation;
- encrypted recovery bundles for local account/device key material.

This provides a useful prototype boundary:

- relay cannot decrypt content without recipient private keys;
- tampering is detected;
- sender authenticity can be checked against directory public keys;
- basic replay against advanced state is rejected by message index checks.
- server-side directory state does not contain device private keys.
- tampering with the transparency log is detectable by hash-chain verification.
- recovery bundles do not expose private keys without the recovery passphrase.

It is still not enough for production messaging.

## Why It Is Not Enough

Production chat encryption needs more than encrypting one payload:

- forward secrecy across messages;
- post-compromise recovery;
- full replay handling for out-of-order delivery;
- skipped-message key handling;
- device addition/removal safety;
- group epoch management;
- user-visible key verification;
- transparency consistency proofs and client monitoring;
- recovery that resists offline passphrase guessing and endpoint compromise;
- audited implementations.

## Production Plan

### Phase 1: Session Bootstrap

Replace the current X3DH-inspired bootstrap with a spec-faithful X3DH/PQXDH implementation:

- identity key;
- signed prekey;
- one-time prekeys;
- optional post-quantum KEM component.
- published test vectors that match the selected specification revision.

### Phase 2: `1:1` Ratcheting

Replace the current DH-ratchet prototype with full Double Ratchet state:

- root key;
- sending chain key;
- receiving chain key;
- per-message keys;
- skipped-message key cache;
- replay protection.
- robust out-of-order delivery windows;
- precise deletion lifecycle for skipped keys.
- state import/export invariants;
- loss recovery behavior for rejected, duplicated, delayed, and replayed messages.

### Phase 3: Multi-Device Semantics

Each device should have an independent ratchet session with every peer device.

For Alice-to-Bob where Bob has two devices:

- Alice phone to Bob phone: one ratchet session;
- Alice phone to Bob laptop: another ratchet session.

### Phase 4: Groups

Use MLS-style group state:

- group epochs;
- member add/remove;
- update path;
- commit messages;
- per-epoch application secrets.
- external commits and resynchronization behavior for long-offline devices.

### Phase 5: Key Transparency

Replace the current linear hash-chain prototype with a production transparency service:

- append-only verifiable map/tree;
- inclusion and consistency proofs;
- client-side monitoring for unexpected device-key changes;
- gossip or witness support to detect split views;
- privacy review for metadata exposed by transparency queries.

### Phase 6: Recovery

Replace the current passphrase-encrypted local bundle with hardened recovery:

- hardware-backed local key storage where available;
- rate-limited remote unlock or secret-sharing design;
- recovery-contact or multi-device recovery UX;
- explicit behavior for stolen, lost, and cloned devices;
- audited backup format and migration policy.

### Phase 7: Verification And Audit

Before production security claims:

- publish a stable protocol spec;
- add test vectors;
- run third-party crypto review;
- fuzz parsers and state transitions;
- add formal threat model review.

## Non-Goals

Do not invent:

- a new block cipher;
- a new signature scheme;
- a custom hash function;
- a custom random generator;
- an unaudited replacement for Double Ratchet or MLS.

## References

- Signal Double Ratchet specification: https://signal.org/docs/specifications/doubleratchet/
- Signal X3DH specification: https://signal.org/docs/specifications/x3dh/
- Signal PQXDH specification: https://signal.org/docs/specifications/pqxdh/
- MLS RFC 9420: https://www.rfc-editor.org/info/rfc9420
- NIST FIPS 203 ML-KEM: https://csrc.nist.gov/pubs/fips/203/final
