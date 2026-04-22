# Crypto Roadmap

## Current Prototype

Current envelope sealing uses standard Node.js cryptographic primitives:

- X25519 ephemeral-static Diffie-Hellman;
- HKDF-SHA256 key derivation;
- AES-256-GCM authenticated encryption;
- Ed25519 sender signatures.

Current message payload delivery now additionally includes:

- per-device pairwise session derivation from X25519;
- directional chain keys;
- one message key per outbound message;
- ratchet index enforcement to reject replay against advanced state;
- Ed25519 signatures over ratcheted payload bodies.

This provides a useful prototype boundary:

- relay cannot decrypt content without recipient private keys;
- tampering is detected;
- sender authenticity can be checked against directory public keys;
- basic replay against advanced state is rejected by message index checks.

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
- audited implementations.

## Production Plan

### Phase 1: Session Bootstrap

Implement an X3DH/PQXDH-style bootstrap:

- identity key;
- signed prekey;
- one-time prekeys;
- optional post-quantum KEM component.

### Phase 2: `1:1` Ratcheting

Replace the current symmetric ratchet prototype with full Double Ratchet state:

- root key;
- sending chain key;
- receiving chain key;
- per-message keys;
- skipped-message key cache;
- replay protection.

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

### Phase 5: Verification And Audit

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
- MLS RFC 9420: https://www.rfc-editor.org/info/rfc9420
- NIST FIPS 203 ML-KEM: https://csrc.nist.gov/pubs/fips/203/final
