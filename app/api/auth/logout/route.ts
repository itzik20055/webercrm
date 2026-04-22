import { NextResponse } from "next/server";
import { logout } from "@/lib/session";

export async function POST(req: Request) {
  await logout();
  return NextResponse.redirect(new URL("/login", req.url));
}
