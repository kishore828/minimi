"use client";

import { useState } from "react";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import type { Conversation } from "@/shared/types";
import { formatRelativeTime, groupConversations } from "@/lib/client/format";
import { api } from "@/lib/client/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface ConversationListProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onMutated: (deletedId?: string) => void;
}

export function ConversationList({ conversations, activeId, onSelect, onMutated }: ConversationListProps) {
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);
  const [renameTarget, setRenameTarget] = useState<Conversation | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [busy, setBusy] = useState(false);

  const groups = groupConversations(conversations);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const deletedId = deleteTarget.id;
    setBusy(true);
    try {
      await api.deleteConversation(deletedId);
      onMutated(deletedId);
    } catch {
      // Surface non-fatal; list refresh keeps the true state.
    } finally {
      setBusy(false);
      setDeleteTarget(null);
    }
  };

  const confirmRename = async () => {
    if (!renameTarget || renameValue.trim().length === 0) {
      setRenameTarget(null);
      return;
    }
    setBusy(true);
    try {
      await api.renameConversation(renameTarget.id, renameValue.trim());
      onMutated();
    } catch {
      // Ignore; the list refresh keeps the true state.
    } finally {
      setBusy(false);
      setRenameTarget(null);
    }
  };

  if (groups.length === 0) {
    return (
      <p className="px-2 py-6 text-center text-xs text-muted-foreground/70">
        No conversations yet.
        <br />
        Ask your first question below.
      </p>
    );
  }

  return (
    <>
      <nav aria-label="Conversations" className="flex flex-col gap-4">
        {groups.map((group) => (
          <div key={group.label}>
            <h3 className="mb-1 px-2 text-[11px] font-semibold tracking-wider text-muted-foreground/70 uppercase">
              {group.label}
            </h3>
            <ul className="space-y-0.5">
              {group.conversations.map((conversation) => (
                <li key={conversation.id} className="group/item relative">
                  <button
                    type="button"
                    onClick={() => onSelect(conversation.id)}
                    className={cn(
                      "flex w-full flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 pr-8 text-left transition-colors",
                      activeId === conversation.id
                        ? "bg-primary/10 text-foreground"
                        : "text-foreground/80 hover:bg-sidebar-accent hover:text-foreground",
                    )}
                    aria-current={activeId === conversation.id ? "page" : undefined}
                  >
                    <span className="w-full truncate text-sm font-medium">{conversation.title}</span>
                    <span className="text-[11px] text-muted-foreground/70">
                      {formatRelativeTime(conversation.updatedAt)} · {conversation.messageCount} msg
                    </span>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity group-hover/item:opacity-100 focus-visible:opacity-100 hover:bg-background hover:text-foreground"
                        aria-label={`Options for ${conversation.title}`}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                      <DropdownMenuItem
                        onClick={() => {
                          setRenameTarget(conversation);
                          setRenameValue(conversation.title);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onClick={() => setDeleteTarget(conversation)}>
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{deleteTarget?.title}&rdquo; and its messages, research and extracted memories will be permanently
              removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={renameTarget !== null} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename conversation</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder="Conversation title"
            maxLength={200}
            onKeyDown={(e) => {
              if (e.key === "Enter") void confirmRename();
            }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button onClick={confirmRename} disabled={busy || renameValue.trim().length === 0}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
