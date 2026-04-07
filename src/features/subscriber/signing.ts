import crypto from "node:crypto";

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET?.trim();

  if (!secret) {
    throw new Error("SESSION_SECRET is not configured.");
  }

  return secret;
}

function signValue(value: string) {
  return crypto
    .createHmac("sha256", getSessionSecret())
    .update(value)
    .digest("base64url");
}

function serializePayload(payload: unknown) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function deserializePayload<T>(value: string) {
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    return JSON.parse(decoded) as T;
  } catch {
    return null;
  }
}

export function createSignedToken(payload: unknown) {
  const encodedPayload = serializePayload(payload);
  const signature = signValue(encodedPayload);

  return `${encodedPayload}.${signature}`;
}

export function verifySignedToken<T>(
  token: string | undefined | null,
  isPayloadValid: (payload: T) => boolean,
) {
  if (!token) {
    return null;
  }

  const [encodedPayload, signature] = token.split(".");

  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = signValue(encodedPayload);
  const expectedBuffer = Buffer.from(expectedSignature);
  const signatureBuffer = Buffer.from(signature);

  if (
    expectedBuffer.length !== signatureBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)
  ) {
    return null;
  }

  const payload = deserializePayload<T>(encodedPayload);

  if (!payload || !isPayloadValid(payload)) {
    return null;
  }

  return payload;
}

export { getSessionSecret };
