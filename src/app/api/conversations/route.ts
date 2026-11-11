/**
 * /api/conversations
 *   GET    — list conversations (optional ?q= full-text search)
 *   POST   — create an empty conversation
 *   DELETE — delete ALL conversations (settings danger zone)
 */
import { conversationCreateSchema } from "@/shared/schemas";
import { AppError } from "@/shared/utils/errors";
import { newId } from "@/shared/utils/ids";
import { DEFAULT_USER_ID, getServices } from "@/server/services";
import { SlidingWindowRateLimiter } from "@/server/http/rate-limit";
import { errorResponse, jsonResponse, parseJsonBody, requestContext } from "@/server/http/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = new SlidingWindowRateLimiter(120);

export async function GET(request: Request): Promise<Response> {
  const { logger } = requestContext(request, getServices().logger);
  try {
    const url = new URL(request.url);
    const query = url.searchParams.get("q") ?? undefined;
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 100) || 100, 200);
    const offset = Math.max(Number(url.searchParams.get("offset") ?? 0) || 0, 0);

    const { repos } = getServices();
    const user = await repos.users.ensureUser(DEFAULT_USER_ID);
    const conversations = await repos.conversations.list(user.id, { query, limit, offset });
    return jsonResponse({ conversations });
  } catch (error) {
    logger.error("conversations.list_failed", {});
    return errorResponse(error, request.headers.get("x-request-id") ?? "n/a");
  }
}

export async function POST(request: Request): Promise<Response> {
  const { logger } = requestContext(request, getServices().logger);
  if (!limiter.check(`conversations:${request.headers.get("x-forwarded-for") ?? "local"}`).allowed) {
    return errorResponse(new AppError("RATE_LIMITED", "Too many requests."), "n/a");
  }
  try {
    let title: string | undefined;
    try {
      const body = await parseJsonBody<unknown>(request);
      const parsed = conversationCreateSchema.safeParse(body ?? {});
      title = parsed.success ? parsed.data.title : undefined;
    } catch {
      title = undefined; // empty body is fine
    }
    const { repos } = getServices();
    const user = await repos.users.ensureUser(DEFAULT_USER_ID);
    const conversation = await repos.conversations.create({
      id: newId("conv"),
      userId: user.id,
      title: title ?? "New conversation",
    });
    return jsonResponse({ conversation }, { status: 201 });
  } catch (error) {
    logger.error("conversations.create_failed", {});
    return errorResponse(error, request.headers.get("x-request-id") ?? "n/a");
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const { logger } = requestContext(request, getServices().logger);
  try {
    const { repos, handle } = getServices();
    const user = await repos.users.ensureUser(DEFAULT_USER_ID);
    const deleted = await repos.conversations.deleteAll(user.id);
    // Reset autoincrement-ish caches; search cache stays (provider-level).
    handle.sqlite.prepare("DELETE FROM search_cache").run();
    logger.warn("conversations.all_deleted", { count: deleted });
    return jsonResponse({ deleted });
  } catch (error) {
    return errorResponse(error, request.headers.get("x-request-id") ?? "n/a");
  }
}
