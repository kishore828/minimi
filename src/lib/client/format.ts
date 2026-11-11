/** Display formatting helpers (browser locale for humans; server stores UTC/ISO). */

export function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatDateShort(iso: string | null): string {
  if (!iso) return "Unknown date";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export interface ConversationLike {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

export interface ConversationGroup<T extends ConversationLike> {
  label: string;
  conversations: T[];
}

/** Group conversations into the familiar recency buckets. */
export function groupConversations<T extends ConversationLike>(conversations: T[]): ConversationGroup<T>[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86_400_000;
  const startOf7Days = startOfToday - 7 * 86_400_000;
  const startOf30Days = startOfToday - 30 * 86_400_000;

  const groups: Record<string, T[]> = {
    Today: [],
    Yesterday: [],
    "Previous 7 days": [],
    "Previous 30 days": [],
    Older: [],
  };

  for (const conversation of conversations) {
    const time = new Date(conversation.updatedAt).getTime();
    if (time >= startOfToday) groups.Today.push(conversation);
    else if (time >= startOfYesterday) groups.Yesterday.push(conversation);
    else if (time >= startOf7Days) groups["Previous 7 days"].push(conversation);
    else if (time >= startOf30Days) groups["Previous 30 days"].push(conversation);
    else groups.Older.push(conversation);
  }

  return Object.entries(groups)
    .filter(([, list]) => list.length > 0)
    .map(([label, list]) => ({ label, conversations: list }));
}
