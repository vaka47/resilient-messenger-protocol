# Account And Invite Model

## Goal

The MVP uses a QR-approved trust chain instead of open public signup:

- the first owner bootstraps the directory with a phone number and password;
- a sponsor creates a QR invite for the invitee's phone number;
- the QR contains a high-entropy one-time secret and referral metadata;
- the invitee completes registration only after scanning the QR, using the same phone number and a confirmed password;
- after registration, that user can sponsor the next user.

This matches the initial product flow: owner confirms a friend by QR, then that friend can confirm family members or other trusted users by QR.

## Server Rules

The directory enforces these invariants:

- only the first account can use `bootstrap-owner`;
- phone numbers are normalized and unique;
- unregistered accounts cannot add devices;
- linked-device registration requires the account password;
- login requires phone plus password;
- QR invite creation requires an active sponsor account;
- a replacement QR automatically invalidates older active invites for the same phone number;
- invite completion requires the exact phone number, valid QR token, unexpired request, and matching password confirmation;
- used invite requests cannot be reused.
- an already registered account can reset its password only through a QR created by the original inviter.

Passwords are stored as salted scrypt hashes. Public account lookup responses do not include password hashes or one-time prekey private material.

## Forgotten Password Flow

If a user forgets the password:

- the user asks the original inviter for a new QR invite;
- the new QR replaces older active invites for that phone number;
- the existing account id and inviter relationship are preserved;
- the password hash is replaced after the QR token, phone, and confirmation password pass validation;
- the new device is added to the existing account.

The account remains the same. Durable chat history still depends on local device state or an encrypted recovery backup because the relay does not store plaintext history.

## Delivery Rules

Relay submission is intentionally strict:

- the sender account and sender device must exist and be active;
- revoked sender devices cannot enqueue envelopes;
- the recipient inbox must exist and belong to an active device;
- revoked recipient devices cannot receive or pull queued envelopes;
- `recipientInboxId` must be listed inside the envelope recipients.

The server still cannot read message plaintext. It validates routing metadata and stores only ciphertext plus queue metadata.

## Current Limitations

This is an MVP account model, not telecom-grade phone verification:

- the QR proves possession of the invite secret, not possession of the SIM card;
- passwords are not yet rate-limited by a production auth gateway;
- no hardware-backed mobile secure storage is implemented in this repository;
- no production abuse controls, device approval UX, or account recovery service exists yet.

Before production launch, add rate limiting, audit logging, device approval screens, secure mobile key storage, and independent security review.
