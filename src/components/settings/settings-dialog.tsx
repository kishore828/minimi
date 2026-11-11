"use client";

import { useCallback, useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { CheckCircle2, Loader2, PlugZap, Trash2, XCircle } from "lucide-react";
import { api, type HealthReport } from "@/lib/client/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConversationsMutated: () => void;
}

type TestState = { status: "idle" | "running" | "ok" | "fail"; detail?: string };

export function SettingsDialog({ open, onOpenChange, onConversationsMutated }: SettingsDialogProps) {
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [llmTest, setLlmTest] = useState<TestState>({ status: "idle" });
  const [searchTest, setSearchTest] = useState<TestState>({ status: "idle" });
  const { theme, setTheme } = useTheme();

  const refresh = useCallback(() => {
    return api
      .health()
      .then((report) => setHealth(report))
      .catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setLlmTest({ status: "idle" });
      setSearchTest({ status: "idle" });
    }
    onOpenChange(next);
  };

  const runTest = async (target: "llm" | "search") => {
    const setter = target === "llm" ? setLlmTest : setSearchTest;
    setter({ status: "running" });
    try {
      const result = await api.testConnection(target);
      setter({ status: result.ok ? "ok" : "fail", detail: result.detail });
    } catch (error) {
      setter({ status: "fail", detail: error instanceof Error ? error.message : "Test failed." });
    }
  };

  const deleteAll = async () => {
    try {
      await api.deleteAllConversations();
      onConversationsMutated();
      onOpenChange(false);
    } catch {
      // Non-fatal; the list refresh keeps the true state.
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Runtime configuration and connection health. Values come from the server environment.</DialogDescription>
        </DialogHeader>

        {/* Runtime info */}
        <section aria-label="Runtime">
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Runtime</h3>
          {health ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg border bg-muted/30 p-3 text-sm">
              <dt className="text-muted-foreground">Status</dt>
              <dd className="text-right font-medium">{health.status === "ok" ? "Healthy" : "Degraded"}</dd>
              <dt className="text-muted-foreground">Model</dt>
              <dd className="text-right font-mono text-[13px]">{health.llm.configured ? health.llm.model : "not configured"}</dd>
              <dt className="text-muted-foreground">Search provider</dt>
              <dd className="text-right font-mono text-[13px]">
                {health.search.provider}
                {health.search.configured ? "" : " (no key)"}
              </dd>
              <dt className="text-muted-foreground">Timezone</dt>
              <dd className="text-right font-mono text-[13px]">{health.timezone}</dd>
              <dt className="text-muted-foreground">Version</dt>
              <dd className="text-right font-mono text-[13px]">{health.version}</dd>
              <dt className="text-muted-foreground">Agent tools</dt>
              <dd className="text-right font-mono text-[13px]">{health.tools.map((t) => t.name).join(", ")}</dd>
            </dl>
          ) : (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              Health endpoint unreachable.
            </p>
          )}
        </section>

        {/* Connection tests */}
        <section aria-label="Connections">
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Connections</h3>
          <div className="flex flex-col gap-2">
            {(
              [
                ["llm", "Model (OpenAI API)", llmTest],
                ["search", "Web search (Tavily API)", searchTest],
              ] as Array<["llm" | "search", string, TestState]>
            ).map(([target, label, state]) => (
              <div key={target} className="flex items-center gap-3 rounded-lg border p-3">
                <PlugZap className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 text-sm">{label}</span>
                {state.status === "ok" && <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> Connected</span>}
                {state.status === "fail" && <span className="flex items-center gap-1 text-xs text-destructive"><XCircle className="h-3.5 w-3.5" /> Failed</span>}
                <Button variant="outline" size="sm" onClick={() => runTest(target)} disabled={state.status === "running"}>
                  {state.status === "running" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Test"}
                </Button>
              </div>
            ))}
          </div>
          {(llmTest.detail || searchTest.detail) && (
            <p className="mt-2 text-xs text-muted-foreground">{llmTest.detail ?? searchTest.detail}</p>
          )}
        </section>

        {/* Appearance */}
        <section aria-label="Appearance">
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Appearance</h3>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label htmlFor="dark-mode" className="text-sm">
                Dark mode
              </Label>
              <p className="text-xs text-muted-foreground">Currently {theme ?? "system"}.</p>
            </div>
            <Switch id="dark-mode" checked={theme === "dark"} onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")} />
          </div>
        </section>

        {/* Limits */}
        {health && (
          <section aria-label="Limits">
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Agent limits</h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg border bg-muted/30 p-3 text-sm">
              <dt className="text-muted-foreground">Max queries / turn</dt>
              <dd className="text-right font-mono text-[13px]">{health.limits.maxSearchQueries}</dd>
              <dt className="text-muted-foreground">Max results / query</dt>
              <dd className="text-right font-mono text-[13px]">{health.limits.maxSearchResults}</dd>
              <dt className="text-muted-foreground">Max iterations</dt>
              <dd className="text-right font-mono text-[13px]">{health.limits.maxAgentIterations}</dd>
              <dt className="text-muted-foreground">Research budget</dt>
              <dd className="text-right font-mono text-[13px]">{health.limits.maxResearchTimeMs / 1000}s</dd>
              <dt className="text-muted-foreground">Cache TTL</dt>
              <dd className="text-right font-mono text-[13px]">{health.limits.searchCacheTtlSeconds}s</dd>
            </dl>
          </section>
        )}

        <Separator />

        {/* Danger zone */}
        <section aria-label="Danger zone">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" className="w-full gap-2">
                <Trash2 className="h-4 w-4" />
                Delete all conversations
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete every conversation?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes all conversations, messages, research history and extracted memories from the
                  local database. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={deleteAll} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Delete everything
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </section>
      </DialogContent>
    </Dialog>
  );
}
