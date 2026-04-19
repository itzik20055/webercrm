import "server-only";
import { cookies } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";

export interface AppSession {
  authenticated?: boolean;
  loggedInAt?: number;
}

const SESSION_COOKIE = "weber_session";

function options(): SessionOptions {
  const password = process.env.SESSION_SECRET;
  if (!password || password.length < 32) {
    throw new Error("SESSION_SECRET must be set and at least 32 characters");
  }
  return {
    password,
    cookieName: SESSION_COOKIE,
    cookieOptions: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    },
  };
}

export async function getSession() {
  const store = await cookies();
  return getIronSession<AppSession>(store, options());
}

export async function isAuthenticated() {
  const session = await getSession();
  return session.authenticated === true;
}

export async function login(password: string) {
  const expected = process.env.APP_PASSWORD;
  if (!expected) {
    throw new Error("APP_PASSWORD is not set");
  }
  if (password !== expected) return false;
  const session = await getSession();
  session.authenticated = true;
  session.loggedInAt = Date.now();
  await session.save();
  return true;
}

export async function logout() {
  const session = await getSession();
  session.destroy();
}
