"use client";

import { formatTimestamp } from "@/lib/client/format";
import type { ChatMessage } from "@/lib/client/use-chat";

export function UserMessage({ message }: { message: ChatMessage }) {
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-slate-200/80 px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap text-slate-900 dark:bg-slate-800 dark:text-slate-100">
        {message.content}
      </div>
      <span className="pr-1 text-[11px] text-muted-foreground/70">{formatTimestamp(message.createdAt)}</span>
    </div>
  );
}
