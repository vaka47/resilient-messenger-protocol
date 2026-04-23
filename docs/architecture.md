# Architecture

## Design Goal

The system is server-light, not serverless. It keeps central infrastructure small by moving durable message history to user devices and limiting relays to encrypted queue storage.

## Components

```mermaid
flowchart TB
  subgraph ClientA["Sender account"]
    A1["Alice phone"]
    A2["Alice laptop"]
  end

  subgraph ClientB["Recipient account"]
    B1["Bob phone"]
    B2["Bob laptop"]
  end

  Directory["Directory service\naccounts, invites, public keys, inbox ids"]
  Relay["Relay service\ntemporary encrypted queues"]
  Transparency["Transparency log\ndevice lifecycle hash chain"]
  LocalLogs["Local event logs\nsource of durable history"]

  A1 -->|"bootstrap owner"| Directory
  B1 -->|"scan sponsor QR invite"| Directory
  B2 -->|"register linked device with password"| Directory

  A1 -->|"lookup Bob devices"| Directory
  A1 -->|"sealed envelope per device"| Relay
  Relay -->|"ciphertext"| B1
  Relay -->|"ciphertext"| B2
  B1 -->|"encrypted ack"| Relay
  B2 -->|"encrypted ack"| Relay
  Relay -->|"ack envelopes"| A1
  Directory -. "revocation state" .-> Relay
  Directory -->|"registration, revocation entries"| Transparency

  A1 --> LocalLogs
  B1 --> LocalLogs
  B2 --> LocalLogs
```

## Message Flow

1. Sender looks up recipient devices in the directory.
2. Sender seals a separate encrypted envelope for each recipient device.
3. Relay stores only ciphertext and queue metadata.
4. Recipient devices pull, decrypt locally, append to local history, and ack.
5. Sender pulls encrypted ack envelopes and updates delivery state.

## Server Responsibilities

Directory service:

- account records;
- unique phone index;
- invite requests and sponsor approvals;
- password hashes for login and linked-device registration;
- device descriptors;
- public encryption and signing keys;
- signed prekey bundles;
- one-time prekey public bundles with consumption;
- inbox identifiers.
- device revocation state;
- key transparency entries for registration and revocation.

Relay service:

- encrypted queue items;
- expiry timestamps;
- delivery acknowledgement removal.
- revoked inbox purge.
- active sender and addressed recipient validation.

The server must not store:

- plaintext messages;
- private keys;
- permanent chat history.
- private recovery passphrases or unencrypted recovery bundles.
- password plaintext.

## Scaling Model

Durable storage lives mostly on devices. Server cost is dominated by:

- directory records;
- temporary queue storage;
- short-lived delivery traffic;
- optional future media escrow.
- append-only transparency metadata.

This is the core infrastructure advantage over a cloud-history messenger.
