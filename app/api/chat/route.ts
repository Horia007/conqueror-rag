import { anthropic } from "@ai-sdk/anthropic";
import { Index } from "@upstash/vector";
import {
  convertToModelMessages,
  pruneMessages,
  streamText,
  type UIMessage,
} from "ai";

export const maxDuration = 30;

const RETRIEVAL_TOP_K = 5;

type ChunkMetadata = {
  title: string;
  url: string;
  images: string[];
  id: string;
};

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

function getLastUserMessageText(messages: UIMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "user") continue;

    const text = message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("")
      .trim();

    if (text) return text;
  }

  return null;
}

function buildContextBlock(
  results: Awaited<ReturnType<Index<ChunkMetadata>["query"]>>,
): string | null {
  const sections = results
    .map((result, index) => {
      const text = result.data?.trim();
      if (!text) return null;

      const title = result.metadata?.title ?? "Unknown";
      const url = result.metadata?.url ?? "";

      return `[${index + 1}] Title: ${title}
URL: ${url}
${text}`;
    })
    .filter((section): section is string => section !== null);

  return sections.length > 0 ? sections.join("\n\n") : null;
}

type RetrievalResult = Awaited<ReturnType<Index<ChunkMetadata>["query"]>>;

async function retrieveContext(query: string): Promise<{
  context: string | null;
  results: RetrievalResult;
}> {
  const restUrl = process.env.UPSTASH_VECTOR_REST_URL;
  const restToken = process.env.UPSTASH_VECTOR_REST_TOKEN;

  if (!restUrl || !restToken) {
    console.warn(
      "RAG skipped: missing UPSTASH_VECTOR_REST_URL or UPSTASH_VECTOR_REST_TOKEN",
    );
    return { context: null, results: [] };
  }

  if (!query.trim()) {
    return { context: null, results: [] };
  }

  try {
    const index = new Index<ChunkMetadata>({
      url: restUrl,
      token: restToken,
    });

    const results = await index.query({
      data: query,
      topK: RETRIEVAL_TOP_K,
      includeMetadata: true,
      includeData: true,
    });

    const context = buildContextBlock(results);

    if (results.length > 0 && !context) {
      console.warn(
        "RAG: query returned results but all chunks lack `data` field",
      );
    }

    return { context, results };
  } catch (error) {
    console.error("Upstash retrieval failed:", error);
    return { context: null, results: [] };
  }
}

function buildRagSystemPrompt(context: string | null): string {
  const contextBlock =
    context ??
    "(No relevant excerpts from the help center were found for this question.)";

  return `You are the customer support assistant for The Conqueror, a virtual fitness
challenge platform where people walk, run, or cycle real distances, track them
in the app, and earn physical medals.

Answer the user's question using ONLY the information in the CONTEXT section
below. The context contains excerpts from The Conqueror's official help center.

Rules:
- Base your answer strictly on the CONTEXT. Do not use outside knowledge about
  The Conqueror, and never invent steps, prices, dates, policies, or details
  that are not in the context.
- If the CONTEXT does not contain enough information to answer, say so honestly
  in one sentence and suggest contacting The Conqueror support (the live chat
  in the app, or their support email). Do not guess.
- Keep answers short and friendly, matching The Conqueror's encouraging,
  adventurous tone. Get to the point — a few sentences, or short numbered steps
  when the answer is a procedure. Don't pad or repeat the question.
- Keep formatting minimal; don't add large headings for short answers.
- Reply in the same language the user used.
- At the end, add a line starting with "Source:" listing the help article(s)
  you actually used, each as a Markdown link [title](url). List each article
  once, even if you used several excerpts from it.

CONTEXT (excerpts from The Conqueror help center):
${contextBlock}`;
}

export async function POST(req: Request) {
  try {
    const { messages }: { messages: UIMessage[] } = await req.json();
    const userQuery = getLastUserMessageText(messages);
    const { context } = userQuery
      ? await retrieveContext(userQuery)
      : { context: null };

    const modelMessages = pruneMessages({
      messages: await convertToModelMessages(sanitizeUIMessages(messages)),
    });

    const result = streamText({
      model: anthropic("claude-sonnet-4-6"),
      system: buildRagSystemPrompt(context),
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
