"use client";

import { useChat } from "@ai-sdk/react";
import { useState } from "react";

import { MarkdownMessage } from "@/components/markdown-message";

export function Chat() {
  const [input, setInput] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [logoVisible, setLogoVisible] = useState(true);

  const { messages, sendMessage, status, error } = useChat({
    onError: (err) => {
      setErrorMessage(
        err.message ||
          "Cererea a eșuat. Verifică ANTHROPIC_API_KEY sau starea API-ului.",
      );
    },
  });

  const displayError = errorMessage ?? error?.message;
  const isEmpty = messages.length === 0;

  const composer = (
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
        className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none transition focus:border-accent/70 focus:ring-2 focus:ring-accent/40 disabled:opacity-50"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Ask anything..."
        disabled={status !== "ready"}
      />
      <button
        type="submit"
        disabled={status !== "ready" || !input.trim()}
        className="rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-black transition hover:bg-accent-strong disabled:opacity-40"
      >
        Trimite
      </button>
    </form>
  );

  const errorBanner = displayError && (
    <div
      role="alert"
      className="mb-4 rounded-xl border border-red-500/30 bg-red-950/40 px-4 py-3 text-sm text-red-200"
    >
      <p className="font-medium">Eroare</p>
      <p className="mt-1">{displayError}</p>
    </div>
  );

  return (
    <div className="app-grid app-glow relative flex h-full min-h-screen flex-col bg-[#0a0a0a]">
      <span className="pointer-events-none fixed left-4 top-4 z-20 text-2xl font-semibold tracking-tight text-zinc-100">
        Martech
      </span>

      {logoVisible && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/logo.png"
          alt="The Conqueror logo"
          className="fixed right-4 top-4 z-20 h-10 w-auto object-contain"
          onError={() => setLogoVisible(false)}
        />
      )}

      {isEmpty ? (
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-4">
          <div className="w-full max-w-2xl">
            <h1 className="mb-8 text-center text-4xl font-semibold tracking-tight text-zinc-50">
              How can I <span className="text-accent">help</span> you?
            </h1>

            {errorBanner}

            {composer}
          </div>
        </div>
      ) : (
        <div className="relative z-10 mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pb-4 pt-16">
          <div className="flex-1 space-y-4 overflow-y-auto pb-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`rounded-xl px-4 py-3 text-sm leading-relaxed ${
                  message.role === "user"
                    ? "ml-8 border border-white/10 bg-white/5 text-zinc-100"
                    : "mr-8 border border-white/10 bg-white/[0.03] text-zinc-200"
                }`}
              >
                <p className="mb-1 text-xs font-medium text-accent/80">
                  {message.role === "user" ? "Tu" : "MartechAI"}
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
              <p className="text-sm text-zinc-500">MartechAI scrie…</p>
            )}
          </div>

          {errorBanner}

          {composer}
        </div>
      )}
    </div>
  );
}
