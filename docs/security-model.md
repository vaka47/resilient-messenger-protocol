# Security Model

## Primary Invariant

The server must not be able to read chat content.

Current prototype invariant:

- plaintext is created on the sender device;
- payload is sealed before it reaches the relay;
- relay stores only ciphertext and queue metadata;
- recipient decrypts locally with a device private key;
- delivery acknowledgements are also encrypted envelopes;
- message payloads use a prototype per-device DH-ratcheted chain key;
- signed prekeys and one-time prekeys bootstrap new sessions;
- prekey private material stays local and is not registered with the directory;
- skipped-message keys support limited out-of-order delivery;
- registration and revocation are written to an append-only key transparency hash chain;
- recovery bundles encrypt local account/device key material before export;
- device fingerprints can be verified by users;
- account signup is invite-only, phone numbers are unique, and linked devices require the account password;
- relay enqueue rejects envelopes for unknown senders, unknown recipients, revoked devices, and inboxes not addressed by the envelope;
- revoked devices are filtered from future fanout and cannot pull their old relay queue.

## What The Prototype Protects

It protects message content from:

- the relay process;
- passive database inspection of relay queues;
- accidental server logs that only include envelope metadata;
- network observers who do not have endpoint device keys.

## What The Prototype Does Not Yet Protect Fully

This repository is not yet production E2EE. Missing pieces:

- no audited full Signal-compatible Double Ratchet implementation;
- no hardened post-compromise recovery after device-key theft;
- no MLS group encryption;
- no production key transparency service with consistency proofs, monitoring, and gossip;
- no hardened production revocation UX;
- no production phone-number verification, login rate limiting, or abuse-prevention gateway;
- no hardware-backed or rate-limited secure backup/recovery flow;
- no push notification privacy design;
- no audited implementation.

## Metadata Still Visible To Relays

Even with encrypted content, relay infrastructure can currently see:

- envelope id;
- sender account id;
- sender device id;
- recipient inbox id;
- payload type;
- approximate ciphertext size;
- queue timing.

Future mitigation:

- rotating inbox ids;
- sealed sender-like addressing;
- batching and jitter;
- cover traffic for high-risk deployments;
- relay federation or user-operated relays.

## Production E2EE Direction

For production, the protocol should adopt well-reviewed building blocks:

- X3DH/PQXDH-style asynchronous session setup;
- Double Ratchet for `1:1` message secrecy, forward secrecy, and post-compromise recovery;
- MLS for groups;
- key transparency for device-key lifecycle visibility;
- secure recovery with hardware-backed local storage and audited backup unlock;
- AEAD and HKDF from mature cryptographic libraries;
- independent security audit before claiming production security.

## Honest Claim

Safe claim for this repo:

> This prototype demonstrates a server-blind message delivery boundary, per-device key advancement, and auditable device lifecycle logging.

Unsafe claim for this repo:

> This is production-grade secure messaging.

That claim requires spec-faithful ratcheting sessions, group key management, hardened device recovery, production transparency, and external audit.
