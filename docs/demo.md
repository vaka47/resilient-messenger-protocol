# Demo Script

This script demonstrates the current protocol flow:

- Alice sends one message.
- Alice bootstraps the first account.
- Bob joins only after scanning a QR invite created by Alice for Bob's phone number.
- Bob has two linked devices.
- Bob can sponsor the next user with the same approval flow.
- Relay stores ciphertext only.
- Both Bob devices decrypt locally.
- Alice receives encrypted delivery acknowledgements.
- Device lifecycle changes appear in the transparency log.
- Alice can export an encrypted local recovery bundle.

## Commands

Start the server:

```bash
npm run server -- --port 8080
```

Create Alice:

```bash
node src/cli.js init --state-dir ./state/alice --name Alice
node src/cli.js bootstrap-owner --state-dir ./state/alice --base-url http://127.0.0.1:8080 --phone +10000000001 --password "alice-password-123" --password-confirm "alice-password-123"
```

Create Bob phone and create Alice's QR invite for Bob:

```bash
node src/cli.js init --state-dir ./state/bob-phone --name Bob
node src/cli.js create-qr-invite --state-dir ./state/alice --base-url http://127.0.0.1:8080 --phone +10000000002
```

Bob scans the QR and completes registration:

```bash
node src/cli.js complete-registration --state-dir ./state/bob-phone --base-url http://127.0.0.1:8080 --request-id REQUEST_ID --qr-token QR_TOKEN --phone +10000000002 --password "bob-password-123" --password-confirm "bob-password-123"
```

Create Bob laptop:

```bash
node src/cli.js link-device --from-state-dir ./state/bob-phone --state-dir ./state/bob-laptop
node src/cli.js register --state-dir ./state/bob-laptop --base-url http://127.0.0.1:8080 --password "bob-password-123"
```

Optional: Bob sponsors Carol:

```bash
node src/cli.js init --state-dir ./state/carol --name Carol
node src/cli.js create-qr-invite --state-dir ./state/bob-phone --base-url http://127.0.0.1:8080 --phone +10000000003
node src/cli.js complete-registration --state-dir ./state/carol --base-url http://127.0.0.1:8080 --request-id CAROL_REQUEST_ID --qr-token CAROL_QR_TOKEN --phone +10000000003 --password "carol-password-123" --password-confirm "carol-password-123"
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

Inspect key transparency:

```bash
node src/cli.js transparency --base-url http://127.0.0.1:8080
```

Export a local recovery bundle:

```bash
node src/cli.js recovery-export --state-dir ./state/alice --out ./state/alice.recovery.json --passphrase "correct horse battery staple"
```

Expected result:

- Bob phone receives the message.
- Bob laptop receives the same message through a separate envelope.
- Bob could only join after scanning Alice's QR invite, and Bob's linked device required Bob's password.
- Alice's outbound event moves to `delivered` after both encrypted acks arrive.
- Relay storage never contains plaintext message text.
- Directory storage contains public prekeys only, not private key material.
- Public directory responses never expose password hashes or one-time prekey private material.
- First sends consume one-time prekeys from the directory.
- Revoked devices are removed from future fanout and cannot pull old queued envelopes.
- Relay rejects envelopes for unknown senders, unknown recipients, revoked devices, and inboxes not listed in the envelope recipients.
- Transparency verification returns `valid: true`.
- Recovery output does not contain plaintext private key PEM fields.
