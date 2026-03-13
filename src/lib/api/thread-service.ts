import { apiClient } from "./client";

export interface ThreadSummary {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  status?: string;
}

export interface ThreadDetail extends ThreadSummary {
  messages: ThreadMessage[];
}

export interface ThreadMessage {
  id: number;
  role: string;
  content: string;
  created_at: string;
  tool_calls?: unknown;
  attachments?: unknown[];
}

export const threadService = {
  list: (limit = 50, offset = 0) =>
    apiClient.get<ThreadSummary[]>(`/api/threads?limit=${limit}&offset=${offset}`),

  get: (threadId: string) =>
    apiClient.get<ThreadDetail>(`/api/threads/${encodeURIComponent(threadId)}`),

  create: (title?: string) =>
    apiClient.post<ThreadSummary>("/api/threads", title ? { title } : undefined),

  delete: (threadId: string) =>
    apiClient.delete(`/api/threads/${encodeURIComponent(threadId)}`),
};
