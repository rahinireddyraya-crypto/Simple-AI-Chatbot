import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";

const SESSION_COOKIE = "goodquestion_session";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getOrCreateChatSession(
  req: Request,
  res: Response,
): string | null {
  if (!process.env.SESSION_SECRET) return null;

  const storedSession = req.signedCookies?.[SESSION_COOKIE];
  if (typeof storedSession === "string" && UUID_PATTERN.test(storedSession)) {
    return storedSession;
  }

  const sessionId = randomUUID();
  res.cookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    signed: true,
    path: "/",
    maxAge: 365 * 24 * 60 * 60 * 1000,
  });
  return sessionId;
}
