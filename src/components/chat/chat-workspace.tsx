"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PanelLeft, Plus, TriangleAlert } from "lucide-react";
import type { Conversation } from "@/shared/types";
import { api, type HealthReport } from "@/lib/client/api";
import { useChat } from "@/lib/client/use-chat";
import { AppSidebar } from "@/components/sidebar/app-sidebar";
import { MessageList } from "@/components/chat/message-list";
import { Composer } from "@/components/chat/composer";
import { WelcomeScreen } from "@/components/chat/welcome-screen";
import { SettingsDialog } from "@/components/settings/settings-dialog";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

export function ChatWorkspace() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [setupWarning, setSetupWarning] = useState<string | null>(null);
  const initialLoadDone = useRef(false);

  const refreshConversations = useCallback(async () => {
    try {
      const result = await api.listConversations();
      setConversations(result.conversations);
    } catch {
      // Sidebar shows stale data rather than nothing.
    }
  }, []);

  const refreshHealth = useCallback(async () => {
    try {
      const report = await api.health();
      setHealth(report);
      if (!report.llm.configured) {
        setSetupWarning(
          "OPENAI_API_KEY is not configured — create a .env file (see .env.example) and restart the server to start chatting.",
        );
      } else if (!report.search.configured) {
        setSetupWarning(
          "TAVILY_API_KEY is not configured — the agent can chat and remember, but cannot research current information.",
        );
      } else {
        setSetupWarning(null);
      }
    } catch {
      setSetupWarning("Server health check failed — is the dev server running?");
    }
  }, []);

  const chat = useChat({
    onConversationChanged: () => {
      void refreshConversations();
    },
  });

  useEffect(() => {
    if (initialLoadDone.current) return;
    initialLoadDone.current = true;
    void refreshConversations();
    void refreshHealth();
  }, [refreshConversations, refreshHealth]);

  const handlePrompt = useCallback(
    (text: string) => {
      void chat.send(text);
    },
    [chat],
  );

  const handleSelect = useCallback(
    async (id: string) => {
      if (chat.state.streaming) chat.abort();
      try {
        await chat.loadConversation(id);
      } catch {
        void refreshConversations();
      }
    },
    [chat, refreshConversations],
  );

  const handleNewChat = useCallback(() => {
    chat.newChat();
  }, [chat]);

  const handleSidebarMutated = useCallback(
    (deletedId?: string) => {
      void refreshConversations();
      if (deletedId && chat.state.conversationId === deletedId) {
        chat.newChat();
      } else if (chat.state.conversationId === null) {
        chat.newChat();
      }
    },
    [chat, refreshConversations],
  );

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden w-72 shrink-0 border-r border-sidebar-border md:block" aria-label="Sidebar">
        <AppSidebar
          conversations={conversations}
          activeId={chat.state.conversationId}
          onSelect={handleSelect}
          onNewChat={handleNewChat}
          onOpenSettings={() => setSettingsOpen(true)}
          onMutated={handleSidebarMutated}
        />
      </aside>

      {/* Mobile sidebar */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-80 p-0 sm:max-w-80">
          <SheetTitle className="sr-only">Conversations</SheetTitle>
          <AppSidebar
            conversations={conversations}
            activeId={chat.state.conversationId}
            onSelect={handleSelect}
            onNewChat={handleNewChat}
            onOpenSettings={() => {
              setSidebarOpen(false);
              setSettingsOpen(true);
            }}
            onMutated={handleSidebarMutated}
            onNavigate={() => setSidebarOpen(false)}
          />
        </SheetContent>
      </Sheet>

      {/* Main column */}
      <main className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="flex h-13 shrink-0 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur sm:px-4">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 md:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open sidebar"
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            {chat.state.conversationId ? chat.state.title : "New conversation"}
          </h1>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleNewChat} aria-label="New conversation">
            <Plus className="h-4 w-4" />
          </Button>
        </header>

        {setupWarning && (
          <div className="flex items-start gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-[13px] text-amber-700 dark:text-amber-400">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="flex-1">{setupWarning}</p>
          </div>
        )}

        {/* Body */}
        {chat.state.messages.length === 0 ? (
          <WelcomeScreen onPrompt={handlePrompt} />
        ) : (
          <MessageList messages={chat.state.messages} onRetry={chat.retry} canRetry={chat.canRetry} />
        )}

        {chat.state.transportError && (
          <div className="border-t border-destructive/30 bg-destructive/5 px-4 py-2 text-[13px] text-destructive">
            {chat.state.transportError}
          </div>
        )}

        <Composer onSend={handlePrompt} onAbort={chat.abort} streaming={chat.state.streaming} />
      </main>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onConversationsMutated={() => {
          void refreshConversations();
          chat.newChat();
        }}
      />
    </div>
  );
}
