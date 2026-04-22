# Group Security Boundary

## Current Status

Group encryption is not implemented in this prototype.

The current implementation supports `1:1` message payloads with one pairwise ratchet session per sender-device and recipient-device pair.

## Why Groups Need A Separate Design

Groups cannot safely reuse naive pairwise fanout forever because large groups need:

- efficient member add/remove;
- epoch-based group state;
- sender authentication;
- protection against removed members reading future messages;
- state recovery for temporarily offline members;
- scalable key updates.

## Intended Production Direction

Use an MLS-style design aligned with RFC 9420:

- group id;
- member credentials;
- group epochs;
- commit messages for add/remove/update;
- per-epoch application secret;
- encrypted application messages bound to epoch and sender.

Implementation requirement:

- do not emulate MLS by encrypting one group key manually;
- use a reviewed MLS implementation or build against RFC 9420 test vectors;
- bind membership changes to the key transparency and device revocation model.

## Prototype Boundary

Safe claim today:

> Small group-like fanout can be modeled as multiple `1:1` encrypted device envelopes.

Unsafe claim today:

> This repository implements production group E2EE.

That requires MLS or an equivalent audited group key-management design.
