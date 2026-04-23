# Mobile Runbook

## Current Status

This repository contains the protocol core, relay/directory server, CLI client, and security tests. It does not yet contain a signed iOS app, Android APK, or production mobile UI.

Current local toolchain check:

- Node.js is available and all protocol tests pass.
- Xcode is installed locally.
- Java, Android SDK, Gradle, and `adb` are not installed in the current environment.

That means the protocol can be run and verified locally now, but an Android file for friends and family cannot be built from this workspace until the Android toolchain and a mobile client project are added.

## Minimum Mobile MVP

The first shippable mobile client should be deliberately small:

- screens: welcome, phone/password, render QR invite, scan QR invite, chat list, chat, device list;
- storage: device private keys in Keychain on iOS and Keystore-backed encrypted storage on Android;
- networking: HTTPS relay/directory API first, push notifications later;
- onboarding: exact QR flow from `docs/account-model.md`;
- messaging: `1:1` text only, one envelope per recipient device;
- safety UI: show account id, device fingerprint, sponsor, revoked devices, and delivery state.

## Build Targets

Recommended implementation path:

- shared protocol core: keep JavaScript package testable in Node first;
- mobile shell: React Native or Expo dev client for fastest iOS/Android iteration;
- iOS distribution: TestFlight first, then App Store if policy permits;
- Android distribution: signed APK/AAB for direct install and Play Console later;
- server: a tiny VPS or home relay running `npm run server`.

## Acceptance Checklist

Before handing the app to another person:

- owner can bootstrap the first account;
- sponsor can create a QR invite for a phone number;
- invitee can complete registration only with the right phone, scanned QR token, and confirmed password;
- wrong QR token, wrong phone, duplicate phone, and wrong password are rejected;
- a replacement QR invalidates older active invites for that phone;
- forgotten-password reset keeps the existing account id and referral link;
- linked-device registration requires the account password;
- messages create ciphertext-only relay entries;
- only addressed active devices receive queued envelopes;
- revoked devices cannot pull old queued messages or receive future messages;
- tests pass in CI.

## Non-Negotiable Production Work

Do not claim production-grade private messaging until these are complete:

- audited X3DH/PQXDH plus full Double Ratchet or a mature audited library;
- secure mobile key storage and recovery design;
- rate limiting and abuse prevention for login and invite endpoints;
- push notification privacy review;
- external security audit;
- privacy policy and legal review for phone-number processing.
