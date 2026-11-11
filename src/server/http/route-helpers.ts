/** Shared helpers for API routes: request ids, JSON responses, error mapping. */
import { NextResponse } from "next/server";
import { toPublicError } from "@/shared/utils/errors";
import { newRequestId } from "@/shared/utils/ids";
import type { Logger } from "@/shared/utils/logger";

export interface RequestContext {
  requestId: string;
  logger: Logger;
  clientKey: string;
}

export function requestContext(request: Request, baseLogger: Logger): RequestContext {
  const requestId = request.headers.get("x-request-id") ?? newRequestId();
  const forwarded = request.headers.get("x-forwarded-for");
  const clientKey = forwarded?.split(",")[0]?.trim() || "local";
  return {
    requestId,
    clientKey,
    logger: baseLogger.child({ requestId, method: request.method, path: new URL(request.url).pathname }),
  };
}

export function jsonResponse(data: unknown, init: { status?: number; requestId?: string } = {}): NextResponse {
  return NextResponse.json(data, {
    status: init.status ?? 200,
    headers: init.requestId ? { "X-Request-Id": init.requestId } : undefined,
  });
}

export function errorResponse(error: unknown, requestId: string): NextResponse {
  const publicError = toPublicError(error);
  return NextResponse.json(
    { error: { code: publicError.code, message: publicError.message, requestId } },
    { status: publicError.status, headers: { "X-Request-Id": requestId } },
  );
}

export async function parseJsonBody<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw Object.assign(new Error("Body must be valid JSON"), { name: "BodyParseError" });
  }
}
