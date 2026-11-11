"use client";

import { Brain, GitCompareArrows, Globe, MessageCircleQuestion } from "lucide-react";
import type { ReactNode } from "react";

interface WelcomeScreenProps {
  onPrompt: (text: string) => void;
}

const EXAMPLES: Array<{ icon: ReactNode; title: string; prompt: string }> = [
  {
    icon: <MessageCircleQuestion className="h-4 w-4" />,
    title: "Recall an earlier discussion",
    prompt: "What did we discuss about CRM tools last week?",
  },
  {
    icon: <GitCompareArrows className="h-4 w-4" />,
    title: "Check what changed",
    prompt: "Has anything changed since we shortlisted those options?",
  },
  {
    icon: <Globe className="h-4 w-4" />,
    title: "Research something current",
    prompt: "Compare the current pricing of Neon and Supabase Postgres plans.",
  },
  {
    icon: <Brain className="h-4 w-4" />,
    title: "Just ask a question",
    prompt: "What is the difference between SQL and NoSQL?",
  },
];

export function WelcomeScreen({ onPrompt }: WelcomeScreenProps) {
  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-6 py-10">
        <div className="mb-8 flex flex-col items-center text-center">
          <img src="/logo.svg" alt="Memento logo" className="mb-4 h-14 w-14 rounded-xl shadow-sm" width={56} height={56} />
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Memento</h1>
          <p className="mt-2 max-w-md text-[15px] leading-relaxed text-muted-foreground">
            Your conversations have a history. The internet keeps changing. Memento connects both — remembering what you
            discussed, researching what&apos;s current, and telling you what changed.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {EXAMPLES.map((example) => (
            <button
              key={example.title}
              type="button"
              onClick={() => onPrompt(example.prompt)}
              className="group flex flex-col items-start gap-2 rounded-xl border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                {example.icon}
              </span>
              <span className="text-sm font-medium text-foreground">{example.title}</span>
              <span className="text-[13px] leading-snug text-muted-foreground">{example.prompt}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
