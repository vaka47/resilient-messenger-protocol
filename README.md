# Resilient Messenger Protocol

This repository starts with two things:

- a `v1` protocol specification for a resilient, local-first messenger;
- a growing reference implementation for message envelopes, transport selection, relay storage, client state, and end-to-end delivery.

## Goals

- Keep cryptography standard and well-vetted.
- Innovate in delivery, transport failover, identity, replication, and server-light storage.
- Default to local-first behavior and delay-tolerant messaging.

## Structure

- `docs/protocol-v1.md`: protocol goals, server roles, packet model, and message lifecycle.
- `src/`: reference implementation of protocol decisions, relay server, client state, and CLI.
- `test/`: executable tests for the reference layer.

## Run

```bash
npm test
```

## MVP Demo

Start the relay and directory server:

```bash
npm run server -- --port 8080
```

In another terminal, initialize and register Alice:

```bash
node src/cli.js init --state-dir ./state/alice --name Alice
node src/cli.js register --state-dir ./state/alice --base-url http://127.0.0.1:8080
```

`init` refuses to overwrite existing state unless you pass `--force`.

Initialize and register Bob:

```bash
node src/cli.js init --state-dir ./state/bob --name Bob
node src/cli.js register --state-dir ./state/bob --base-url http://127.0.0.1:8080
```

Add a second Bob device if you want to test multi-device fanout:

```bash
node src/cli.js link-device --from-state-dir ./state/bob --state-dir ./state/bob-laptop
node src/cli.js register --state-dir ./state/bob-laptop --base-url http://127.0.0.1:8080
```

Send a text message using Bob's `accountId`:

```bash
node src/cli.js send --state-dir ./state/alice --base-url http://127.0.0.1:8080 --to BOB_ACCOUNT_ID --text "hello"
```

Sync Bob's inbox:

```bash
node src/cli.js sync --state-dir ./state/bob --base-url http://127.0.0.1:8080
node src/cli.js inbox --state-dir ./state/bob
```

## Current Scope

This MVP supports:

- local device identity;
- linked devices for the same account;
- directory registration;
- relay queue delivery with delivery ack;
- signed and encrypted `1:1` envelopes for text payloads;
- multi-device recipient fanout;
- local event history on each device.

This is still a prototype. It is not yet a production messenger:

- there is no Double Ratchet implementation yet;
- there is no MLS group engine yet;
- there is no nearby transport implementation yet;
- there are no mobile apps yet.
