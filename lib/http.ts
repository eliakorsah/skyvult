import { NextResponse } from "next/server";
import { HttpError } from "./auth";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function fail(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

export function handleError(err: unknown) {
  if (err instanceof HttpError) return fail(err.status, err.message);
  if (err && typeof err === "object" && "issues" in (err as any)) {
    return fail(400, "Validation failed");
  }
  console.error(err);
  return fail(500, "Internal server error");
}
