/**
 * POST /api/chat — streams an agent turn as Server-Sent Events.
 *
 * Every research stage, search query, source, comparison, token and the
 * final metrics arrive as typed SSE events (src/shared/types/events.ts).
 * Aborting the request persists any partial answer instead of corrupting
 * history.
 */
import { chatRequestSchema } from "@/shared/schemas";
import { AppError } from "@/shared/utils/errors";
import { DEFAULT_USER_ID, getServices } from "@/server/services";
import { SlidingWindowRateLimiter } from "@/server/http/rate-limit";
import { encodeSseEvent, sseHeaders } from "@/server/http/sse";
import { errorResponse, parseJsonBody, requestContext } from "@/server/http/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = new SlidingWindowRateLimiter(30);

export async function POST(request: Request): Promise<Response> {
  const { logger, clientKey } = requestContext(request, getServices().logger);

  const limit = limiter.check(`chat:${clientKey}`);
  if (!limit.allowed) {
    return Response.json(
      { error: { code: "RATE_LIMITED", message: "Too many chat requests. Slow down a little." } },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await parseJsonBody(request);
  } catch {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: "Body must be valid JSON." } }, { status: 400 });
  }

  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid request." } },
      { status: 400 },
    );
  }

  const { orchestrator, repos } = getServices();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        try {
          const user = await repos.users.ensureUser(DEFAULT_USER_ID);
          const events = orchestrator.runTurn({
            userId: user.id,
            conversationId: parsed.data.conversationId ?? null,
            message: parsed.data.message,
            reuseUserMessageId: parsed.data.retryOf ?? null,
            signal: request.signal,
          });

          for await (const event of events) {
            try {
              controller.enqueue(encodeSseEvent(event));
            } catch {
              // Client disconnected: keep draining so the turn (including
              // partial-answer persistence) completes server-side.
            }
          }
        } catch (error) {
          const appError = error instanceof AppError ? error : null;
          const message =
            appError?.expose === true ? appError.message : "The assistant could not complete this turn.";
          logger.error("chat.stream_failed", { code: appError?.code ?? "INTERNAL" });
          try {
            controller.enqueue(encodeSseEvent({ type: "error", code: appError?.code ?? "INTERNAL", message }));
          } catch {
            // Client already gone.
          }
        } finally {
          try {
            controller.close();
          } catch {
            // Already closed.
          }
        }
      })();
    },
  });

  return new Response(stream, { headers: sseHeaders() });
}

export async function GET(): Promise<Response> {
  return errorResponse(new AppError("NOT_FOUND", "Use POST for /api/chat."), "n/a");
}
