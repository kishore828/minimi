import type { DatabaseHandle } from "../db";
import { ConversationsRepository } from "./conversations";
import { MemoriesRepository } from "./memories";
import { MessagesRepository } from "./messages";
import { ResearchRepository } from "./research";
import { SearchCacheRepository } from "./search-cache";
import { UsersRepository } from "./users";

export interface Repositories {
  users: UsersRepository;
  conversations: ConversationsRepository;
  messages: MessagesRepository;
  memories: MemoriesRepository;
  research: ResearchRepository;
  searchCache: SearchCacheRepository;
}

export function createRepositories(handle: DatabaseHandle): Repositories {
  return {
    users: new UsersRepository(handle),
    conversations: new ConversationsRepository(handle),
    messages: new MessagesRepository(handle),
    memories: new MemoriesRepository(handle),
    research: new ResearchRepository(handle),
    searchCache: new SearchCacheRepository(handle),
  };
}

export { persistTurn, type TurnPersistenceInput } from "./turns";
export { UsersRepository, type UserRecord } from "./users";
export { ConversationsRepository } from "./conversations";
export { MessagesRepository, type MessageWithContext } from "./messages";
export { MemoriesRepository, type NewMemory } from "./memories";
export { ResearchRepository, type ResearchRecord } from "./research";
export { SearchCacheRepository } from "./search-cache";
