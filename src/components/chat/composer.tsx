"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ComposerProps {
  onSend: (text: string) => void;
  onAbort: () => void;
  streaming: boolean;
}

export function Composer({ onSend, onAbort, streaming }: ComposerProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  useEffect(resize, [value]);

  const submit = () => {
    const trimmed = value.trim();
    if (trimmed.length === 0 || streaming) return;
    onSend(trimmed);
    setValue("");
    requestAnimationFrame(resize);
  };

  return (
    <div className="border-t bg-background/80 backdrop-blur">
      <div className="mx-auto w-full max-w-3xl px-4 py-4 sm:px-6">
        <div
          className={cn(
            "flex items-end gap-2 rounded-2xl border bg-card p-2 pl-4 shadow-sm transition-shadow",
            "focus-within:ring-2 focus-within:ring-ring/30",
          )}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder="Ask about anything — or something we discussed before…"
            className="max-h-[200px] min-h-[28px] flex-1 resize-none bg-transparent py-1.5 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground/60"
            aria-label="Message"
            disabled={streaming}
          />
          {streaming ? (
            <Button
              type="button"
              size="icon"
              variant="secondary"
              onClick={onAbort}
              className="h-9 w-9 shrink-0 rounded-xl"
              aria-label="Stop generating"
            >
              <Square className="h-4 w-4 fill-current" />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              onClick={submit}
              disabled={value.trim().length === 0}
              className="h-9 w-9 shrink-0 rounded-xl"
              aria-label="Send message"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          )}
        </div>
        <p className="mt-2 text-center text-[11px] text-muted-foreground/60">
          Memento searches the web only when needed and cites what it finds. Enter to send · Shift+Enter for a new line.
        </p>
      </div>
    </div>
  );
}
