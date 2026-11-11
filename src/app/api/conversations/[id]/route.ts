/**
 * /api/conversations/[id]
 *   GET   — full conversation with messages; assistant messages carry their
 *           persisted research (citations + comparisons) so the UI can
 *           re-render past research faithfully.
 *   PATCH — rename
 *   DELETE — remove conversation and all dependent rows
 */
import { conversationPatchSchema } from "@/shared/schemas";
import { AppError } from "@/shared/utils/errors";
import { DEFAULT_USER_ID, getServices } from "@/server/services";
import { errorResponse, jsonResponse, parseJsonBody, requestContext } from "@/server/http/route-helpers";
import type { ClaimComparison, ConversationMessage, SourceRef } from "@/shared/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface ConversationMessageWithResearch extends ConversationMessage {
  citations: SourceRef[];
  comparisons: ClaimComparison[] | null;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  const { logger } = requestContext(request, getServices().logger);
  try {
    const { repos } = getServices();
    const user = await repos.users.ensureUser(DEFAULT_USER_ID);
    const conversation = await repos.conversations.get(user.id, id);
    if (!conversation) {
      throw new AppError("NOT_FOUND", "Conversation not found.", { status: 404 });
    }

    const [messages, researchRecords] = await Promise.all([
      repos.messages.listByConversation(id, 500),
      repos.research.listByConversation(id),
    ]);

    const researchByMessage = new Map(researchRecords.map((record) => [record.messageId, record]));
    const enriched: ConversationMessageWithResearch[] = messages.map((message) => {
      const record = researchByMessage.get(message.id);
      return {
        ...message,
        citations: record?.evidence ?? [],
        comparisons: record?.comparisons ?? null,
      };
    });

    const memories = await repos.memories.listByConversation(id);
    const summary = await repos.research.getSummary(id);

    return jsonResponse({
      conversation,
      messages: enriched,
      summary,
      memories: memories.map((m) => ({ content: m.content, category: m.category, createdAt: m.createdAt })),
    });
  } catch (error) {
    logger.error("conversation.get_failed", { id });
    return errorResponse(error, request.headers.get("x-request-id") ?? "n/a");
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  const { logger } = requestContext(request, getServices().logger);
  try {
    const body = await parseJsonBody<unknown>(request);
    const parsed = conversationPatchSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid title.");
    }
    const { repos } = getServices();
    const user = await repos.users.ensureUser(DEFAULT_USER_ID);
    const renamed = await repos.conversations.rename(user.id, id, parsed.data.title);
    if (!renamed) throw new AppError("NOT_FOUND", "Conversation not found.", { status: 404 });
    return jsonResponse({ ok: true, title: parsed.data.title });
  } catch (error) {
    logger.error("conversation.rename_failed", { id });
    return errorResponse(error, request.headers.get("x-request-id") ?? "n/a");
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  const { logger } = requestContext(request, getServices().logger);
  try {
    const { repos } = getServices();
    const user = await repos.users.ensureUser(DEFAULT_USER_ID);
    const deleted = await repos.conversations.delete(user.id, id);
    if (!deleted) throw new AppError("NOT_FOUND", "Conversation not found.", { status: 404 });
    logger.info("conversation.deleted", { id });
    return jsonResponse({ ok: true });
  } catch (error) {
    logger.error("conversation.delete_failed", { id });
    return errorResponse(error, request.headers.get("x-request-id") ?? "n/a");
  }
}
