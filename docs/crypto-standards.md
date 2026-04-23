# Cryptographic Standards Plan

## Current Position

The repository demonstrates the product boundary: relays do not need plaintext, devices own private keys, delivery is per addressed device, and QR onboarding is referral-bound. It is not yet a production-audited cryptographic implementation.

The production target should be based on existing reviewed specifications, not new custom primitives.

## 1:1 Sessions

Production `1:1` messaging should move from the current prototype ratchet to the Signal specifications:

- X3DH for asynchronous session setup with identity keys, signed prekeys, and one-time prekeys.
- PQXDH when post-quantum handshake protection is required.
- Double Ratchet for per-message forward secrecy and post-compromise security.

Primary references:

- Signal X3DH: https://signal.org/docs/specifications/x3dh/
- Signal PQXDH: https://signal.org/docs/specifications/pqxdh/
- Signal Double Ratchet: https://signal.org/docs/specifications/doubleratchet/

Implementation requirements:

- deterministic test vectors for every handshake branch;
- strict one-time prekey consumption and depletion monitoring;
- replay and duplicate detection;
- skipped-message-key lifecycle limits;
- corrupted-session recovery behavior;
- parser fuzzing for serialized session state.

## Groups

Production group messaging should use MLS, not pairwise fanout, once groups become a core feature.

Primary reference:

- IETF RFC 9420, Messaging Layer Security: https://www.ietf.org/rfc/rfc9420

Implementation requirements:

- MLS group epochs;
- add/remove/update commits;
- external joins;
- member credential validation;
- removed-member forward secrecy;
- delivery-service compromise tests.

## Post-Quantum Handshake

For post-quantum key establishment, use NIST ML-KEM from FIPS 203 through an audited library/provider. Do not implement ML-KEM manually in this repository.

Primary reference:

- NIST FIPS 203, Module-Lattice-Based Key-Encapsulation Mechanism Standard: https://csrc.nist.gov/pubs/fips/203/final

Important note: NIST lists a November 17, 2025 planning note for future FIPS 203 errata. Track that errata before claiming compliance.

## Device Revocation And Verification

Already implemented at prototype level:

- revoked devices are removed from future fanout;
- revoked inbox queues are purged on pull;
- relay rejects sends from or to revoked devices;
- device lifecycle is recorded in a verifiable hash chain;
- users can compute and verify device fingerprints.

Production requirements:

- user-facing QR fingerprint verification;
- transparency consistency proofs, not only a linear hash chain;
- client monitoring for unexpected device additions;
- witness/gossip support against split-view attacks;
- auditable UI for revocation reason, actor, and time.

## Audit Gate

Do not claim "more secure than Signal/WhatsApp" until these are complete:

- spec-faithful Signal Double Ratchet implementation or audited library integration;
- X3DH/PQXDH conformance tests;
- MLS RFC 9420 implementation or audited library integration for groups;
- FIPS 203 ML-KEM provider integration and errata tracking;
- mobile secure storage review;
- third-party protocol and implementation audit;
- reproducible builds and dependency supply-chain review.
