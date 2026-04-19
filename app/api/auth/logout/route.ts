import { NextResponse } from "next/server";
import { logout } from "@/lib/session";

export async function POST() {
  await logout();
  return NextResponse.redirect(new URL("/login", process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"));
}
