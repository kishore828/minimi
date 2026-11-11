"use client";

import { useState } from "react";
import { AlertTriangle, Check, Copy, RotateCcw, Square } from "lucide-react";
import type { ChatMessage } from "@/lib/client/use-chat";
import { MarkdownContent } from "./markdown-content";
import { ResearchPanel } from "@/components/research/research-panel";
import { ComparisonTable } from "@/components/research/comparison-table";
import { SourceList } from "@/components/citations/source-list";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface AssistantMessageProps {
  message: ChatMessage;
  isLast: boolean;
  onRetry: () => void;
  canRetry: boolean;
}

export function AssistantMessage({ message, isLast, onRetry, canRetry }: AssistantMessageProps) {
  const [copied, setCopied] = useState(false);
  const isStreaming = message.status === "streaming" || message.status === "pending";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (permissions); silently ignore.
    }
  };

  return (
    <div className="flex flex-col gap-1">
      {message.research && <ResearchPanel trace={message.research} streaming={isStreaming} defaultOpen={false} />}

      <div className="min-w-0">
        {message.content.length > 0 && (
          <div className={cn(isStreaming && "streaming-cursor")}>
            <MarkdownContent content={message.content} citations={message.citations} />
          </div>
        )}

        {message.status === "pending" && message.content.length === 0 && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="flex gap-1" aria-label="Assistant is working">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/60 [animation-delay:0ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/60 [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/60 [animation-delay:300ms]" />
            </span>
          </div>
        )}

        {message.comparisons && message.comparisons.length > 0 && (
          <ComparisonTable comparisons={message.comparisons} citations={message.citations} />
        )}

        <SourceList citations={message.citations} />
      </div>

      {message.status === "error" && (
        <Alert variant="destructive" className="mt-2">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <span>{message.errorMessage ?? "The assistant could not complete this turn."}</span>
            {isLast && canRetry && (
              <Button size="sm" variant="outline" onClick={onRetry} className="w-fit">
                <RotateCcw className="h-3.5 w-3.5" />
                Retry
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {!isStreaming && message.content.length > 0 && message.status !== "error" && (
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground/70">
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Copy response"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
          {message.interrupted && (
            <span className="inline-flex items-center gap-1">
              <Square className="h-3 w-3 fill-current" />
              Interrupted
            </span>
          )}
          {message.metrics && (
            <span className="tabular-nums">
              {(message.metrics.durationMs / 1000).toFixed(1)}s
              {message.metrics.searchCalls > 0 && ` · ${message.metrics.searchCalls} search${message.metrics.searchCalls === 1 ? "" : "es"}`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
