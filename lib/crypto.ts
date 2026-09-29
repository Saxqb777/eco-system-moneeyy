import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Pasted credentials are encrypted at rest with AES 256 GCM. The key lives only in the
// SECRETS_KEY env var (32 bytes, base64). Stored form: v1:<iv b64>:<ciphertext plus tag b64>

function keyBytes(): Buffer {
  const raw = process.env.SECRETS_KEY;
  if (!raw) throw new Error("SECRETS_KEY is not set");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("SECRETS_KEY must decode to 32 bytes");
  return buf;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${Buffer.concat([ct, tag]).toString("base64")}`;
}

export function decryptSecret(stored: string): string {
  const [v, ivB64, dataB64] = stored.split(":");
  if (v !== "v1" || !ivB64 || !dataB64) throw new Error("Unknown secret format");
  const iv = Buffer.from(ivB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const ct = data.subarray(0, data.length - 16);
  const tag = data.subarray(data.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

export function secretHint(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "set";
  return `ends with ${trimmed.slice(-4)}`;
}
