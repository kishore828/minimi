"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Moon, PanelLeft, Plus, Search, Settings, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import type { Conversation } from "@/shared/types";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ConversationList } from "./conversation-list";

interface AppSidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onOpenSettings: () => void;
  onMutated: (deletedId?: string) => void;
  /** Rendered inside the mobile Sheet; hides the desktop-only collapse button. */
  onNavigate?: () => void;
}

export function AppSidebar({
  conversations,
  activeId,
  onSelect,
  onNewChat,
  onOpenSettings,
  onMutated,
  onNavigate,
}: AppSidebarProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [searchState, setSearchState] = useState<{ query: string; items: Conversation[] } | null>(null);
  const { theme, setTheme } = useTheme();
  // Hydration-safe mounted flag without setState-in-effect.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (debouncedQuery.length === 0) return;
    let cancelled = false;
    api
      .listConversations(debouncedQuery)
      .then((res) => {
        if (!cancelled) setSearchState({ query: debouncedQuery, items: res.conversations });
      })
      .catch(() => {
        if (!cancelled) setSearchState(null);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  const titleFiltered =
    debouncedQuery.length > 0
      ? conversations.filter(
          (c) =>
            c.title.toLowerCase().includes(debouncedQuery.toLowerCase()) ||
            debouncedQuery
              .split(/\s+/)
              .some((token) => token.length > 2 && c.title.toLowerCase().includes(token)),
        )
      : conversations;
  const activeSearchResults =
    debouncedQuery.length > 0 && searchState?.query === debouncedQuery ? searchState.items : null;
  const filtered = debouncedQuery.length > 0 ? (activeSearchResults ?? titleFiltered) : conversations;

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <img src="/logo.svg" alt="Memento logo" width={26} height={26} className="rounded-[7px]" />
        <span className="text-[15px] font-semibold tracking-tight">Memento</span>
        {onNavigate && (
          <Button variant="ghost" size="icon" className="ml-auto h-7 w-7" onClick={onNavigate} aria-label="Close sidebar">
            <PanelLeft className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* New conversation */}
      <div className="px-3">
        <Button
          onClick={() => {
            onNewChat();
            onNavigate?.();
          }}
          className="w-full justify-start gap-2 rounded-lg"
          size="sm"
        >
          <Plus className="h-4 w-4" />
          New conversation
        </Button>
      </div>

      {/* Search */}
      <div className="px-3 pt-3 pb-1">
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations"
            className="h-8 rounded-lg border-sidebar-border bg-background/60 pl-8 text-[13px]"
            aria-label="Search conversations"
          />
        </div>
      </div>

      {/* Conversation list */}
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {debouncedQuery.length > 0 && filtered.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground/70">No conversations match &ldquo;{debouncedQuery}&rdquo;.</p>
        ) : (
          <ConversationList
            conversations={filtered}
            activeId={activeId}
            onSelect={(id) => {
              onSelect(id);
              onNavigate?.();
            }}
            onMutated={onMutated}
          />
        )}
      </div>

      {/* Footer */}
      <div className="mt-auto">
        <Separator className="bg-sidebar-border" />
        <div className="flex items-center justify-between px-3 py-2.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenSettings}
            className="gap-2 text-muted-foreground hover:text-foreground"
          >
            <Settings className="h-4 w-4" />
            Settings
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label="Toggle theme"
          >
            {mounted && theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
