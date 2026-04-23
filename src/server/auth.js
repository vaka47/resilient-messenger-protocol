import crypto from "node:crypto";

export function normalizePhone(phone) {
  if (typeof phone !== "string") {
    throw new TypeError("phone must be a string");
  }

  const normalized = phone.replace(/[^\d+]/g, "");

  if (!/^\+?\d{10,15}$/.test(normalized)) {
    throw new Error("phone must contain 10-15 digits and may start with +");
  }

  return normalized.startsWith("+") ? normalized : `+${normalized}`;
}

export function assertPasswordConfirmed(password, passwordConfirm) {
  if (password !== passwordConfirm) {
    throw new Error("password confirmation does not match");
  }

  if (typeof password !== "string" || password.length < 10) {
    throw new Error("password must be at least 10 characters");
  }
}

export function createPasswordRecord(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);

  return {
    profile: "SCRYPT-SHA256-V1",
    saltB64: salt.toString("base64"),
    hashB64: hash.toString("base64"),
  };
}

export function verifyPassword(password, record) {
  if (typeof password !== "string" || !record?.saltB64 || !record?.hashB64) {
    return false;
  }

  const salt = Buffer.from(record.saltB64, "base64");
  const expected = Buffer.from(record.hashB64, "base64");
  const actual = crypto.scryptSync(password, salt, expected.length);

  return crypto.timingSafeEqual(actual, expected);
}

export function createQrInviteToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function createQrInviteTokenRecord(token) {
  const salt = crypto.randomBytes(16);
  const digest = crypto
    .createHash("sha256")
    .update(salt)
    .update(token)
    .digest();

  return {
    profile: "QR-INVITE-TOKEN-SHA256-V1",
    saltB64: salt.toString("base64"),
    digestB64: digest.toString("base64"),
  };
}

export function verifyQrInviteToken(token, record) {
  if (typeof token !== "string" || token.length < 32 || !record?.saltB64 || !record?.digestB64) {
    return false;
  }

  const salt = Buffer.from(record.saltB64, "base64");
  const expected = Buffer.from(record.digestB64, "base64");
  const actual = crypto
    .createHash("sha256")
    .update(salt)
    .update(token)
    .digest();

  return crypto.timingSafeEqual(actual, expected);
}
