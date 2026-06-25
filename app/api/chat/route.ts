import { anthropic } from "@ai-sdk/anthropic";
import {
  convertToModelMessages,
  pruneMessages,
  streamText,
  type UIMessage,
} from "ai";

export const maxDuration = 30;

const SYSTEM_PROMPT = "You are a helpful assistant.";

function getSystemPrompt(override?: string): string {
  const prompt = (override ?? SYSTEM_PROMPT).trim();
  return prompt.length > 0 ? prompt : SYSTEM_PROMPT;
}

function sanitizeUIMessages(messages: UIMessage[]): Omit<UIMessage, "id">[] {
  return messages
    .map(({ id: _id, ...message }) => ({
      ...message,
      parts: message.parts.filter(
        (part) => part.type !== "text" || part.text.trim().length > 0,
      ),
    }))
    .filter((message) => message.parts.length > 0);
}

export async function POST(req: Request) {
  try {
    const { messages }: { messages: UIMessage[] } = await req.json();

    const modelMessages = pruneMessages({
      messages: await convertToModelMessages(sanitizeUIMessages(messages)),
    });

    const result = streamText({
      model: anthropic("claude-sonnet-4-6"),
      system: getSystemPrompt(),
      messages: modelMessages,
    });

    return result.toUIMessageStreamResponse({
      onError: (error) => {
        if (error == null) return "Eroare necunoscută.";
        if (typeof error === "string") return error;
        if (error instanceof Error) return error.message;
        return JSON.stringify(error);
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Eroare la procesarea cererii de chat.";

    return Response.json({ error: message }, { status: 500 });
  }
}
