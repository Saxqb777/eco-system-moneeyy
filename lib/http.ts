import { NextResponse } from "next/server";

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, { ...init, headers: { "cache-control": "no-store", ...(init?.headers ?? {}) } });
}

export function unauthorized(message = "Unauthorized") {
  return json({ ok: false, error: message }, { status: 401 });
}

export function bad(message: string, status = 400) {
  return json({ ok: false, error: message }, { status });
}

export function bearerOk(req: Request, expectedEnv = "CRON_SECRET"): boolean {
  const expected = process.env[expectedEnv];
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}
