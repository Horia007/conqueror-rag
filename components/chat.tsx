"use client";

import { useChat } from "@ai-sdk/react";
import { useState } from "react";

import { MarkdownMessage } from "@/components/markdown-message";

export function Chat() {
  const [input, setInput] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { messages, sendMessage, status, error } = useChat({
    onError: (err) => {
      setErrorMessage(
        err.message ||
          "Cererea a eșuat. Verifică ANTHROPIC_API_KEY sau starea API-ului.",
      );
    },
  });

  const displayError = errorMessage ?? error?.message;

  return (
    <div className="flex h-full min-h-screen flex-col max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-xl font-semibold mb-6 text-zinc-900 dark:text-zinc-100">
        Chat cu Claude
      </h1>

      <div className="flex-1 space-y-4 overflow-y-auto mb-4">
        {messages.length === 0 && (
          <p className="text-sm text-zinc-500">Scrie un mesaj pentru a începe.</p>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`rounded-lg px-4 py-3 text-sm leading-relaxed ${
              message.role === "user"
                ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100 ml-8"
                : "bg-white border border-zinc-200 text-zinc-800 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-200 mr-8"
            }`}
          >
            <p className="text-xs font-medium mb-1 text-zinc-500">
              {message.role === "user" ? "Tu" : "Claude"}
            </p>
            {message.role === "assistant" ? (
              <MarkdownMessage
                content={message.parts
                  .filter((part) => part.type === "text")
                  .map((part) => part.text)
                  .join("")}
              />
            ) : (
              message.parts.map((part, index) =>
                part.type === "text" ? (
                  <span key={index} className="whitespace-pre-wrap">
                    {part.text}
                  </span>
                ) : null,
              )
            )}
          </div>
        ))}

        {(status === "submitted" || status === "streaming") && (
          <p className="text-sm text-zinc-500">Claude scrie…</p>
        )}
      </div>

      {displayError && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        >
          <p className="font-medium">Eroare</p>
          <p className="mt-1">{displayError}</p>
        </div>
      )}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!input.trim() || status !== "ready") return;

          setErrorMessage(null);
          sendMessage({ text: input });
          setInput("");
        }}
      >
        <input
          className="flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Mesajul tău…"
          disabled={status !== "ready"}
        />
        <button
          type="submit"
          disabled={status !== "ready" || !input.trim()}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Trimite
        </button>
      </form>
    </div>
  );
}
