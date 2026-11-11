import { eq } from "drizzle-orm";
import { users } from "../schema";
import type { DatabaseHandle } from "../db";

export interface UserRecord {
  id: string;
  createdAt: string;
}

export class UsersRepository {
  constructor(private readonly handle: DatabaseHandle) {}

  /** Single-user local deployment: the default user is created on demand. */
  async ensureUser(id: string): Promise<UserRecord> {
    const existing = this.handle.db.select().from(users).where(eq(users.id, id)).get();
    if (existing) {
      return { id: existing.id, createdAt: new Date(existing.createdAt).toISOString() };
    }
    const createdAt = Date.now();
    this.handle.db.insert(users).values({ id, createdAt }).run();
    return { id, createdAt: new Date(createdAt).toISOString() };
  }
}
