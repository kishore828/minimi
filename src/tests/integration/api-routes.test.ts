/**
 * HTTP-level tests for the REST routes (no LLM involved): conversations
 * CRUD, health, and request validation — exercised through the real Next.js
 * route handlers.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dbFile = path.join(os.tmpdir(), `memento-api-test-${Date.now()}.db`);

beforeAll(() => {
  process.env.DATABASE_URL = dbFile;
  process.env.OPENAI_API_KEY = "";
  process.env.TAVILY_API_KEY = "";
});

afterAll(() => {
  fs.rmSync(dbFile, { force: true });
  fs.rmSync(`${dbFile}-wal`, { force: true });
  fs.rmSync(`${dbFile}-shm`, { force: true });
});

// Import AFTER env is set: routes lazily build services from process env.
const { GET: listConversations, POST: createConversation, DELETE: deleteAll } = await import(
  "@/app/api/conversations/route"
);
const { GET: getConversation, PATCH: patchConversation, DELETE: deleteConversation } = await import(
  "@/app/api/conversations/[id]/route"
);
const { GET: getHealth, POST: postHealth } = await import("@/app/api/health/route");
const { POST: postChat } = await import("@/app/api/chat/route");

function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("conversations API", () => {
  it("creates, lists, fetches, renames and deletes conversations", async () => {
    // Create
    const created = await createConversation(jsonRequest("http://localhost/api/conversations", "POST", {}));
    expect(created.status).toBe(201);
    const { conversation } = (await created.json()) as { conversation: { id: string; title: string } };
    expect(conversation.title).toBe("New conversation");

    // Seed a message directly through services to have content for the detail view.
    const { getServices, DEFAULT_USER_ID } = await import("@/server/services");
    const services = getServices();
    await services.repos.messages.create({
      id: "msg_seed_1",
      conversationId: conversation.id,
      role: "user",
      content: "Hello from the API test",
    });

    // List
    const listed = await listConversations(new Request("http://localhost/api/conversations"));
    const listBody = (await listed.json()) as { conversations: Array<{ id: string; messageCount: number }> };
    expect(listed.status).toBe(200);
    expect(listBody.conversations.some((c) => c.id === conversation.id)).toBe(true);
    expect(listBody.conversations.find((c) => c.id === conversation.id)?.messageCount).toBe(1);

    // List with full-text search
    const searched = await listConversations(new Request("http://localhost/api/conversations?q=API test"));
    const searchBody = (await searched.json()) as { conversations: Array<{ id: string }> };
    expect(searchBody.conversations.some((c) => c.id === conversation.id)).toBe(true);

    // Detail includes messages
    const detail = await getConversation(
      new Request(`http://localhost/api/conversations/${conversation.id}`),
      { params: Promise.resolve({ id: conversation.id }) },
    );
    const detailBody = (await detail.json()) as { messages: Array<{ content: string; citations: unknown[] }> };
    expect(detail.status).toBe(200);
    expect(detailBody.messages).toHaveLength(1);
    expect(detailBody.messages[0].citations).toEqual([]);

    // Rename
    const renamed = await patchConversation(
      jsonRequest(`http://localhost/api/conversations/${conversation.id}`, "PATCH", { title: "Renamed" }),
      { params: Promise.resolve({ id: conversation.id }) },
    );
    expect(renamed.status).toBe(200);

    // Delete
    const deleted = await deleteConversation(
      new Request(`http://localhost/api/conversations/${conversation.id}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: conversation.id }) },
    );
    expect(deleted.status).toBe(200);
    const gone = await getConversation(
      new Request(`http://localhost/api/conversations/${conversation.id}`),
      { params: Promise.resolve({ id: conversation.id }) },
    );
    expect(gone.status).toBe(404);
  });

  it("rejects invalid rename payloads", async () => {
    const response = await patchConversation(
      jsonRequest("http://localhost/api/conversations/conv_missing", "PATCH", { title: "" }),
      { params: Promise.resolve({ id: "conv_missing" }) },
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});

describe("health API", () => {
  it("reports configuration state without leaking keys", async () => {
    const response = await getHealth();
    const body = (await response.json()) as {
      status: string;
      llm: { configured: boolean };
      search: { configured: boolean };
      tools: Array<{ name: string }>;
      timezone: string;
    };
    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.llm.configured).toBe(false); // no key in test env
    expect(body.search.configured).toBe(false);
    expect(body.tools).toEqual([{ name: "web_search", description: expect.any(String) }]);
    expect(body.timezone).toBe("Asia/Kolkata");
    expect(JSON.stringify(body)).not.toMatch(/sk-|tvly-/);
  });

  it("reports a clean failure for connection tests without keys", async () => {
    const response = await postHealth(jsonRequest("http://localhost/api/health", "POST", { target: "search" }));
    const body = (await response.json()) as { ok: boolean; detail: string };
    expect(body.ok).toBe(false);
    expect(body.detail).toContain("TAVILY_API_KEY");
  });
});

describe("chat API validation", () => {
  it("rejects an empty message with 400", async () => {
    const response = await postChat(jsonRequest("http://localhost/api/chat", "POST", { message: "" }));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("reports a missing API key as a stream error event (not a crash)", async () => {
    const response = await postChat(jsonRequest("http://localhost/api/chat", "POST", { message: "hi" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const text = await response.text();
    expect(text).toContain("data: ");
    const event = JSON.parse(text.split("data: ")[1]) as { type: string; code: string };
    expect(event.type).toBe("error");
    expect(event.code).toBe("MISSING_API_KEY");
  });
});
