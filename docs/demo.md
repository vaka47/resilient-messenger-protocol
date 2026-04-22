# Demo Script

This script demonstrates the current protocol flow:

- Alice sends one message.
- Bob has two linked devices.
- Relay stores ciphertext only.
- Both Bob devices decrypt locally.
- Alice receives encrypted delivery acknowledgements.

## Commands

Start the server:

```bash
npm run server -- --port 8080
```

Create Alice:

```bash
node src/cli.js init --state-dir ./state/alice --name Alice
node src/cli.js register --state-dir ./state/alice --base-url http://127.0.0.1:8080
```

Create Bob phone:

```bash
node src/cli.js init --state-dir ./state/bob-phone --name Bob
node src/cli.js register --state-dir ./state/bob-phone --base-url http://127.0.0.1:8080
```

Create Bob laptop:

```bash
node src/cli.js link-device --from-state-dir ./state/bob-phone --state-dir ./state/bob-laptop
node src/cli.js register --state-dir ./state/bob-laptop --base-url http://127.0.0.1:8080
```

Send from Alice:

```bash
node src/cli.js send --state-dir ./state/alice --base-url http://127.0.0.1:8080 --to BOB_ACCOUNT_ID --text "hello from a server-blind relay"
```

Sync Bob devices:

```bash
node src/cli.js sync --state-dir ./state/bob-phone --base-url http://127.0.0.1:8080
node src/cli.js sync --state-dir ./state/bob-laptop --base-url http://127.0.0.1:8080
```

Sync Alice for delivery acks:

```bash
node src/cli.js sync --state-dir ./state/alice --base-url http://127.0.0.1:8080
node src/cli.js inbox --state-dir ./state/alice
```

Inspect a cached device fingerprint:

```bash
node src/cli.js fingerprint --state-dir ./state/alice --account-id BOB_ACCOUNT_ID --device-id BOB_DEVICE_ID
```

Mark the device as verified after comparing the fingerprint out-of-band:

```bash
node src/cli.js verify-device --state-dir ./state/alice --account-id BOB_ACCOUNT_ID --device-id BOB_DEVICE_ID --fingerprint "FINGERPRINT"
```

Revoke Bob laptop:

```bash
node src/cli.js revoke-device --state-dir ./state/bob-phone --base-url http://127.0.0.1:8080 --device-id BOB_LAPTOP_DEVICE_ID
```

Expected result:

- Bob phone receives the message.
- Bob laptop receives the same message through a separate envelope.
- Alice's outbound event moves to `delivered` after both encrypted acks arrive.
- Relay storage never contains plaintext message text.
- Revoked devices are removed from future fanout and cannot pull old queued envelopes.
