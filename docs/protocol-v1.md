# Resilient Messenger Protocol v1

## 1. Purpose

This protocol is designed for messaging in hostile network conditions:

- intermittent or blocked mobile internet;
- high-latency and delay-tolerant delivery;
- partial connectivity through relays or nearby transports;
- pressure to minimize central server cost and metadata exposure.

The design target is not "another cloud messenger". The design target is:

- local-first messaging;
- standard end-to-end cryptography;
- multi-transport delivery;
- server-light architecture;
- user-controlled data ownership.

## 2. Threat Model

The protocol should tolerate:

- internet outages lasting hours or days;
- relay unavailability;
- some blocked entrypoints;
- passive metadata collection by servers;
- delayed delivery and reordering;
- device loss and multi-device recovery.

The protocol does not promise:

- anonymity against a global active adversary;
- zero metadata leakage in all network conditions;
- perfect delivery with no reachable path;
- full feature parity on platforms with restrictive background limits.

## 3. Design Rules

### 3.1 What is standard

These are not invented in-house:

- `1:1 session establishment`: X3DH or PQXDH-like handshake.
- `1:1 message secrecy`: Double Ratchet.
- `group messaging`: MLS-like group state and key updates.
- `primitives`: AEAD, HKDF, secure signatures, CSPRNG from mature libraries.

The current codebase contains a prototype envelope sealing layer plus a per-device DH-ratchet for message payloads. It is useful for demonstrating that relays do not need plaintext access, that message keys can advance, that replies can perform DH-ratchet turns, and that one-time prekeys can be consumed. It is still not a replacement for audited production Double Ratchet or MLS.

### 3.2 What is novel

These are the areas of differentiation:

- transport-agnostic message envelopes;
- policy-based transport selection;
- local-first append-only event logs;
- relay queues with bounded retention;
- user-device-first replication;
- nearby and delay-tolerant sync;
- metadata-minimizing addressing and rotating inbox identifiers.
- verifiable device lifecycle transparency.

## 4. Logical Layers

### 4.1 Identity layer

Each account owns:

- a root identity key;
- one or more device keys;
- a rotating set of inbox descriptors.

Phone number is optional and external to core identity. Identity is anchored in keys, not in a server-side username.

### 4.2 Crypto session layer

This layer manages:

- `1:1` sessions;
- group epochs and membership;
- rekey and recovery;
- forward secrecy and post-compromise recovery.

### 4.3 Envelope layer

Every protocol event is encoded as a transport-agnostic encrypted envelope.

Envelope fields:

- envelope id;
- conversation id;
- sender device id;
- recipient routing descriptors;
- payload type;
- priority;
- creation time;
- expiry;
- ciphertext;
- media references;
- delivery hints.

### 4.4 Transport layer

The same encrypted envelope may travel over:

- direct internet connection;
- relay queue over HTTPS/WebSocket/QUIC;
- nearby sync over Bluetooth or Wi-Fi;
- SMS-sized control payloads for emergency signaling only.

Transport selection is dynamic and policy-driven.

### 4.5 Storage layer

The source of truth is the user's local append-only event log.

Server roles are reduced to:

- key directory;
- relay queues;
- push bridge;
- optional fallback media escrow.

History is not intended to live permanently on the platform's servers.

## 5. Packet Types

Core payload classes:

- `message`: encrypted user content.
- `ack`: delivery acknowledgement.
- `receipt`: optional read or seen receipt.
- `membership`: group changes.
- `key_update`: rekey, device add/remove, epoch updates.
- `media_manifest`: metadata for chunked encrypted media.
- `sync_offer`: advertise missing event ranges.
- `sync_chunk`: transfer missing events or media chunks.
- `emergency_control`: compact control packet suitable for severe fallback paths.

## 6. Transport Policy

The client should evaluate available paths in this order:

1. direct internet path to destination or trusted relay;
2. secondary relay path;
3. nearby peer path;
4. SMS-sized emergency control path when payload allows.

Policy input includes:

- payload size;
- priority;
- urgency;
- channel cost;
- observed success rate;
- battery state;
- proximity of trusted peers;
- current censorship or blocking profile.

## 7. Replication Strategy

### 7.1 Messages

Conversation messages are stored on:

- sender devices;
- recipient devices;
- temporary relay queues until ack or expiry.

### 7.2 Media

Media is encrypted client-side and chunked. Chunks may be stored on:

- sender home devices;
- recipient devices after fetch;
- optional trusted relays;
- optional cheap object storage as last resort.

Possible optimization:

- erasure coding for large media sets;
- TTL-based background eviction;
- partial local pinning by importance.

### 7.3 Home relays

Users or communities may operate small home relays:

- mini VPS;
- home server;
- volunteer infrastructure.

These relays do not need plaintext access.

## 8. Server Roles

### 8.1 Directory service

Stores:

- identity metadata required for session bootstrap;
- device descriptors;
- key transparency or revocation statements;
- relay bootstrap lists.

This service should be tiny and strongly verifiable.

Current prototype:

- publishes only public device and prekey material;
- consumes one-time prekeys during session bootstrap;
- appends registration and revocation events to a verifiable hash-chain transparency log.

### 8.2 Relay service

Stores:

- encrypted queue items;
- minimal routing metadata;
- expiry and delivery state.

It should not store permanent message history.

It must never receive plaintext payloads or private keys.

### 8.3 Push bridge

Used only to wake clients where OS restrictions require it.

### 8.4 Escrow storage

Optional service for media or delayed handoff when no peer path exists.

### 8.5 Recovery bundle

Recovery is client-owned, not server plaintext escrow.

Current prototype:

- exports account/device key material only after encrypting it locally;
- derives an AES-256-GCM key from a passphrase with scrypt;
- restores into a fresh local state without restoring prior sessions or event history.

Production recovery must add hardware-backed storage, rate limiting or secret sharing, and clear UX for stolen or cloned devices.

## 9. Message Lifecycle

### 9.1 Send

1. Client creates local event.
2. Payload is encrypted for the target conversation state.
3. Envelope is persisted locally.
4. Transport policy ranks available paths.
5. Envelope is submitted to one or more paths.

### 9.2 Relay

1. Relay accepts only encrypted envelope and queue metadata.
2. Relay stores until ack, expiry, or retention ceiling.
3. Relay may forward to downstream relay or waiting device.

### 9.3 Receive

1. Device receives envelope.
2. Device deduplicates by envelope id.
3. Device decrypts and appends event locally.
4. Device emits ack through any available path.

### 9.4 Recovery

When connectivity returns:

1. devices exchange vector state or missing ranges;
2. missing envelopes are requested;
3. media is fetched lazily;
4. group epochs are reconciled.

## 10. Why Someone Switches

The user benefit is not "custom cryptography". It is:

- chat keeps working in poor networks;
- data is primarily on user devices;
- smaller infrastructure footprint;
- less server-side metadata concentration;
- flexible deployment for communities or organizations.

## 11. MVP Scope

The first useful version should be:

- Android-first;
- text-first;
- `1:1` and small groups;
- internet + relay queue as primary path;
- local-first event log;
- nearby sync as optional second path;
- SMS fallback limited to emergency control or tiny invites.

Do not start with:

- voice/video;
- large public channels;
- giant group fanout;
- custom cryptographic primitives;
- full peer-only operation with zero infrastructure.

## 12. Commercial Note

This protocol can be positioned as:

- standalone resilient messenger;
- white-label crisis communications stack;
- protocol/IP package licensable to a larger messaging platform.

The most realistic near-term value is a working reference stack with measurable resilience, not a speculative acquisition pitch.
