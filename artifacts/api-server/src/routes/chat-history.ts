import { Router, type IRouter } from "express";
import { getOrCreateChatSession } from "../lib/chat-session";
import {
  ChatStoreError,
  clearChatMessages,
  loadChatMessages,
} from "../lib/supabase-chat-store";

const router: IRouter = Router();

function sendStoreError(
  req: { log: { error: (context: object, message: string) => void } },
  res: { status: (status: number) => { json: (body: object) => void } },
  error: unknown,
): void {
  if (error instanceof ChatStoreError) {
    req.log.error({ kind: error.kind }, error.message);
    res.status(503).json({
      error: error.message,
      service: "database",
    });
    return;
  }
  req.log.error({ err: error }, "Supabase chat history request failed");
  res.status(503).json({
    error: "Chat history is temporarily unavailable. Please try again.",
    service: "database",
  });
}

router.get("/chat/history", async (req, res): Promise<void> => {
  const sessionId = getOrCreateChatSession(req, res);
  if (!sessionId) {
    res.status(503).json({
      error: "Chat history is not configured. Add the SESSION_SECRET secret.",
      service: "database",
    });
    return;
  }

  try {
    const messages = await loadChatMessages(sessionId);
    res.json({ messages });
  } catch (error) {
    sendStoreError(req, res, error);
  }
});

router.delete("/chat/history", async (req, res): Promise<void> => {
  const sessionId = getOrCreateChatSession(req, res);
  if (!sessionId) {
    res.status(503).json({
      error: "Chat history is not configured. Add the SESSION_SECRET secret.",
      service: "database",
    });
    return;
  }

  try {
    await clearChatMessages(sessionId);
    res.sendStatus(204);
  } catch (error) {
    sendStoreError(req, res, error);
  }
});

export default router;
