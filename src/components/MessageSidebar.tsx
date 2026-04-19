"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Loader2,
  MessageCircle,
  RefreshCw,
  Send,
  X,
} from "lucide-react";

type Sender = "patient" | "dentist";
type MessageStatus = "pending" | "sent" | "error";

interface Message {
  id: string;
  content: string;
  sender: Sender;
  createdAt: string;
  status?: MessageStatus;
  optimisticId?: string;
}

interface MessageSidebarProps {
  patientId: string;
  isOpen: boolean;
  onClose: () => void;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function MessageBubble({
  msg,
  onRetry,
}: {
  msg: Message;
  onRetry: (msg: Message) => void;
}) {
  const isPatient = msg.sender === "patient";
  const isPending = msg.status === "pending";
  const isError = msg.status === "error";

  return (
    <div className={`mb-3 flex ${isPatient ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[78%]">
        <p
          className={`mb-1 text-[10px] uppercase tracking-wide text-zinc-600 ${
            isPatient ? "text-right" : "text-left"
          }`}
        >
          {isPatient ? "Patient" : "Clinician"}
        </p>
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
            isPatient
              ? "rounded-br-sm bg-blue-600 text-white"
              : "rounded-bl-sm bg-zinc-800 text-zinc-100"
          } ${isPending ? "opacity-60" : ""} ${
            isError ? "!bg-red-900/60 border border-red-700" : ""
          }`}
        >
          {msg.content}
        </div>

        <div
          className={`mt-1 flex items-center gap-1.5 ${
            isPatient ? "justify-end" : "justify-start"
          }`}
        >
          {isPending && (
            <span className="text-[10px] tracking-wide text-zinc-600">
              Sending...
            </span>
          )}
          {isError && (
            <button
              onClick={() => onRetry(msg)}
              className="flex items-center gap-1 text-[10px] text-red-400 transition-colors hover:text-red-300"
            >
              <AlertCircle size={10} />
              Failed - tap to retry
              <RefreshCw size={10} />
            </button>
          )}
          {!isPending && !isError && (
            <span className="text-[10px] text-zinc-600">
              {formatTime(msg.createdAt)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MessageSidebar({
  patientId,
  isOpen,
  onClose,
}: MessageSidebarProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sender, setSender] = useState<Sender>("patient");
  const [isLoading, setIsLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    async function loadHistory() {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/messaging?patientId=${patientId}`);
        const data = await res.json();

        if (data.ok) {
          setMessages(
            data.messages.map((message: Message) => ({
              ...message,
              status: "sent" as MessageStatus,
            })),
          );
        }
      } catch {
        console.error("Failed to load message history");
      } finally {
        setIsLoading(false);
      }
    }

    loadHistory();
  }, [isOpen, patientId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!isOpen) return;

    const timer = window.setTimeout(() => inputRef.current?.focus(), 150);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  const sendMessage = useCallback(
    async (
      content: string,
      messageSender: Sender,
      existingOptimisticId?: string,
    ) => {
      const optimisticId = existingOptimisticId ?? `optimistic-${Date.now()}`;
      const now = new Date().toISOString();

      if (!existingOptimisticId) {
        setMessages((prev) => [
          ...prev,
          {
            id: optimisticId,
            optimisticId,
            content,
            sender: messageSender,
            createdAt: now,
            status: "pending",
          },
        ]);
      } else {
        setMessages((prev) =>
          prev.map((message) =>
            message.optimisticId === optimisticId
              ? { ...message, status: "pending" as MessageStatus }
              : message,
          ),
        );
      }

      try {
        const res = await fetch("/api/messaging", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            patientId,
            content,
            sender: messageSender,
          }),
        });

        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error ?? "Send failed");

        setMessages((prev) =>
          prev.map((message) =>
            message.optimisticId === optimisticId
              ? { ...data.message, status: "sent" as MessageStatus }
              : message,
          ),
        );
      } catch {
        setMessages((prev) =>
          prev.map((message) =>
            message.optimisticId === optimisticId
              ? { ...message, status: "error" as MessageStatus }
              : message,
          ),
        );
      }
    },
    [patientId],
  );

  const handleSend = useCallback(() => {
    const content = input.trim();
    if (!content) return;

    setInput("");
    sendMessage(content, sender);
  }, [input, sendMessage, sender]);

  const handleRetry = useCallback(
    (msg: Message) => {
      if (msg.optimisticId) {
        sendMessage(msg.content, msg.sender, msg.optimisticId);
      }
    },
    [sendMessage],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={onClose}
        />
      )}

      <div
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-sm transform flex-col border-l border-zinc-800 bg-zinc-950 transition-transform duration-300 ease-in-out ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600/20">
              <MessageCircle size={16} className="text-blue-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Messages</p>
              <p className="text-[11px] text-zinc-500">
                Patient and clinician conversation
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-white"
            aria-label="Close messaging"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {isLoading ? (
            <div className="flex h-full items-center justify-center gap-2 text-zinc-600">
              <Loader2 size={16} className="animate-spin" />
              <span className="text-xs">Loading messages...</span>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <MessageCircle size={32} className="text-zinc-700" />
              <p className="text-sm text-zinc-500">No messages yet.</p>
              <p className="text-xs text-zinc-600">
                Start a conversation about this scan.
              </p>
            </div>
          ) : (
            messages.map((msg) => (
              <MessageBubble
                key={msg.optimisticId ?? msg.id}
                msg={msg}
                onRetry={handleRetry}
              />
            ))
          )}
          <div ref={bottomRef} />
        </div>

        <div className="shrink-0 border-t border-zinc-800 px-4 py-4">
          <div className="mb-3 grid grid-cols-2 gap-2 rounded-lg bg-zinc-900 p-1">
            {(["patient", "dentist"] as Sender[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setSender(option)}
                className={`rounded-md px-3 py-2 text-xs font-medium capitalize transition-colors ${
                  sender === option
                    ? "bg-blue-600 text-white"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                {option === "dentist" ? "Clinician" : "Patient"}
              </button>
            ))}
          </div>

          <div className="flex items-end gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 transition-colors focus-within:border-zinc-600">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Type as ${
                sender === "dentist" ? "clinician" : "patient"
              }...`}
              rows={1}
              className="max-h-32 flex-1 resize-none overflow-y-auto bg-transparent text-sm leading-relaxed text-white outline-none placeholder-zinc-600"
              style={{ scrollbarWidth: "none" }}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              aria-label="Send message"
              className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <Send size={14} className="text-white" />
            </button>
          </div>
          <p className="mt-2 text-center text-[10px] text-zinc-700">
            Enter to send. Shift+Enter for a new line.
          </p>
        </div>
      </div>
    </>
  );
}
