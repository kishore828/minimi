"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "@/lib/client/use-chat";
import { UserMessage } from "./user-message";
import { AssistantMessage } from "./assistant-message";

interface MessageListProps {
  messages: ChatMessage[];
  onRetry: () => void;
  canRetry: boolean;
}

/** Scrollable message history with smart auto-scroll (sticks to bottom
 *  while the user hasn't scrolled away). */
export function MessageList({ messages, onRetry, canRetry }: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (nearBottomRef.current) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages]);

  const handleScroll = () => {
    const container = containerRef.current;
    if (!container) return;
    const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
    nearBottomRef.current = distance < 120;
  };

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto overscroll-contain"
      role="log"
      aria-live="polite"
      aria-label="Conversation messages"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
        {messages.map((message, index) =>
          message.role === "user" ? (
            <UserMessage key={message.id} message={message} />
          ) : (
            <AssistantMessage
              key={message.id}
              message={message}
              isLast={index === messages.length - 1}
              onRetry={onRetry}
              canRetry={canRetry}
            />
          ),
        )}
        <div className="h-2 shrink-0" aria-hidden />
      </div>
    </div>
  );
}
