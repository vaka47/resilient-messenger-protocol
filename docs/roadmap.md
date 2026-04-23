# Product Roadmap

## Stage 0: Current Starter

Already implemented:

- protocol v1 spec;
- local device identity;
- linked devices on the same account;
- encrypted and signed `1:1` message envelopes;
- prototype per-device DH-ratcheted message chains;
- signed prekey and one-time prekey bootstrap;
- skipped-message key cache;
- append-only key transparency hash-chain prototype;
- encrypted local recovery bundle prototype;
- file-backed directory and relay;
- multi-device fanout and delivery acknowledgements;
- device fingerprints and revocation enforcement;
- local event history;
- end-to-end tested send, sync, decrypt, and ack flow.

## Stage 1: Usable Internal Alpha

Build next:

- Android client with local database;
- background sync worker;
- contact add flow by sponsor-created QR invite;
- better queue retry and backoff;
- message status transitions: queued, relayed, delivered, seen.

Exit criteria:

- two Android devices can exchange messages over the relay in unreliable network conditions.

## Stage 2: Resilience Upgrade

Build next:

- multiple relay endpoints per user;
- rotating inbox identifiers;
- nearby sync transport;
- attachment upload and chunk fetch;
- bounded media escrow;
- relay observability and queue pressure controls.

Exit criteria:

- system survives relay outages and reconnects after long offline windows.

## Stage 3: Cryptographic Hardening

Build next:

- replace prototype envelope crypto with audited protocol components;
- replace DH-ratchet prototype with spec-faithful Double Ratchet for `1:1`;
- replace X3DH-inspired bootstrap with spec-faithful X3DH/PQXDH;
- define group implementation around MLS;
- harden recovery flows, transparency, and audited revocation UX;
- perform independent security review.

Exit criteria:

- security boundary is documented well enough for outside audit.

## Stage 4: Sale-Ready Package

Build next:

- hosted relay deployment guide;
- white-label packaging;
- server cost model per active user;
- resilience benchmarks under packet loss and blocked endpoints;
- demo build and buyer deck.

Exit criteria:

- product can be pitched either as a standalone tool or as licensable infrastructure.
