import { apiClient } from "./client";

export interface KnowledgeListResponse {
  data: Array<Record<string, unknown>>;
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
