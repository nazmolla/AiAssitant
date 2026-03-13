import { apiClient } from "./client";

export interface KnowledgeEntry {
  id: number;
  key: string;
  value: string;
  source_type: string;
  created_at: string;
}

export interface KnowledgeListResponse {
  data: KnowledgeEntry[];
  total: number;
  hasMore: boolean;
}

export const knowledgeService = {
  list: (limit = 100, offset = 0) =>
    apiClient.get<KnowledgeListResponse>(`/api/knowledge?limit=${limit}&offset=${offset}`),

  update: (id: number, value: string) =>
    apiClient.put("/api/knowledge", { id, value }),

  delete: (id: number) =>
    apiClient.delete(`/api/knowledge?id=${id}`),
};
