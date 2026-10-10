import type { GeminiChatMessage } from "@workspace/api-zod";

type StoredChatMessage = GeminiChatMessage;

export class ChatStoreError extends Error {
  constructor(
    message: string,
    readonly kind: "not-configured" | "schema-missing" | "request-failed",
  ) {
    super(message);
    this.name = "ChatStoreError";
  }
}

function getConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const serviceRoleKey = process.env.SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new ChatStoreError(
      "Supabase is not configured. Add SUPABASE_URL and SERVICE_ROLE_KEY.",
      "not-configured",
    );
  }
  return { url, serviceRoleKey };
}

async function requestChatTable(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const { url, serviceRoleKey } = getConfig();
  let response: Response;
  try {
    response = await fetch(`${url}/rest/v1/chat_sessions${path}`, {
      ...init,
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
  } catch {
    throw new ChatStoreError(
      "Could not connect to Supabase. Check the project URL and try again.",
      "request-failed",
    );
  }

  if (response.status === 404 || response.status === 406) {
    throw new ChatStoreError(
      "The chat_sessions table is missing in Supabase. Run the setup SQL file included with this project.",
      "schema-missing",
    );
  }
  if (!response.ok) {
    throw new ChatStoreError(
      "Supabase could not save or load this chat. Check the database setup and try again.",
      "request-failed",
    );
  }
  return response;
}

export async function loadChatMessages(
  sessionId: string,
): Promise<StoredChatMessage[]> {
  const params = new URLSearchParams({
    select: "messages",
    session_id: `eq.${sessionId}`,
    limit: "1",
  });
  const response = await requestChatTable(`?${params.toString()}`);
  const rows: unknown = await response.json();
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const messages = (rows[0] as { messages?: unknown })?.messages;
  if (!Array.isArray(messages)) {
    throw new ChatStoreError(
      "Supabase returned an invalid chat history.",
      "request-failed",
    );
  }
  return messages.filter((message): message is StoredChatMessage =>
    typeof message === "object" &&
    message !== null &&
    ((message as StoredChatMessage).role === "user" ||
      (message as StoredChatMessage).role === "assistant") &&
    typeof (message as StoredChatMessage).content === "string",
  );
}

export async function saveChatMessages(
  sessionId: string,
  messages: StoredChatMessage[],
): Promise<void> {
  await requestChatTable("?on_conflict=session_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      session_id: sessionId,
      messages,
      updated_at: new Date().toISOString(),
    }),
  });
}

export async function clearChatMessages(sessionId: string): Promise<void> {
  const params = new URLSearchParams({ session_id: `eq.${sessionId}` });
  await requestChatTable(`?${params.toString()}`, { method: "DELETE" });
}
