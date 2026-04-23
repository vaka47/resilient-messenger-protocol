# Account And Invite Model

## Goal

The MVP uses a human-approved trust chain instead of open public signup:

- the first owner bootstraps the directory with a phone number and password;
- a new user requests access with their phone number and a sponsor phone number;
- only the sponsor account can approve that request;
- approval creates a random 5-digit code that must be shared out-of-band;
- the invitee completes registration with the same phone number, the code, and a confirmed password;
- after registration, that user can sponsor the next user.

This matches the initial product flow: owner confirms a friend, then that friend can confirm family members or other trusted users.

## Server Rules

The directory enforces these invariants:

- only the first account can use `bootstrap-owner`;
- phone numbers are normalized and unique;
- unregistered accounts cannot add devices;
- linked-device registration requires the account password;
- login requires phone plus password;
- invite requests require an active sponsor phone;
- a phone number can have only one active pending or approved invite request;
- invite approval requires the sponsor account id that owns the request;
- invite completion requires the exact phone number, valid code, unexpired request, and matching password confirmation;
- used invite requests cannot be reused.

Passwords are stored as salted scrypt hashes. Public account lookup responses do not include password hashes or one-time prekey private material.

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

- the 5-digit code is human-mediated, not SMS-verified;
- passwords are not yet rate-limited by a production auth gateway;
- no hardware-backed mobile secure storage is implemented in this repository;
- no production abuse controls, device approval UX, or account recovery service exists yet.

Before production launch, add rate limiting, audit logging, device approval screens, secure mobile key storage, and independent security review.
