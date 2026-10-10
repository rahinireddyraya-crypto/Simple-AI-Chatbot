import { GoogleGenAI } from "@google/genai";
import { SendGeminiChatBody } from "@workspace/api-zod";
import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.post("/gemini/chat", async (req, res): Promise<void> => {
  const parsed = SendGeminiChatBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(503).json({
      error:
        "Gemini is not configured. Add the GEMINI_API_KEY secret to this Replit project.",
    });
    return;
  }

  const ai = new GoogleGenAI({ apiKey });

  try {
    const stream = await ai.models.generateContentStream({
      model: "gemini-2.5-flash",
      contents: parsed.data.messages.map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      })),
      config: {
        maxOutputTokens: 8192,
        systemInstruction:
          "You are a helpful, clear, and friendly assistant. Answer directly and ask a brief follow-up question when it would help.",
      },
    });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) {
        res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (error) {
    req.log.error({ err: error }, "Gemini chat request failed");

    if (res.headersSent) {
      res.write(
        `data: ${JSON.stringify({ error: "Gemini could not finish this reply. Please try again." })}\n\n`,
      );
      res.end();
      return;
    }

    res.status(502).json({
      error: "Gemini could not finish this reply. Please try again.",
    });
  }
});

export default router;
