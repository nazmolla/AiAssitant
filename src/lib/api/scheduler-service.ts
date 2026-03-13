import { apiClient } from "./client";

export const schedulerService = {
  getTasks: () => apiClient.get<unknown>("/api/scheduler"),
  getTask: (id: string) => apiClient.get<unknown>(`/api/scheduler?id=${encodeURIComponent(id)}`),
  deleteTask: (id: string) => apiClient.delete(`/api/scheduler?id=${encodeURIComponent(id)}`),
  toggleTask: (id: string, enabled: boolean) =>
    apiClient.put("/api/scheduler", { id, enabled }),
  triggerTask: (id: string) =>
    apiClient.post("/api/scheduler", { action: "trigger", id }),
  getBatchConfig: () => apiClient.get<unknown>("/api/config/scheduler"),
  saveBatchConfig: (config: unknown) => apiClient.put("/api/config/scheduler", config),
};
