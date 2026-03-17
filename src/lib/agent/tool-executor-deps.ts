import { addLog } from "@/lib/db/log-queries";
import { getUserById } from "@/lib/db/user-queries";
import { getToolPolicy, createApprovalRequest, findApprovalPreferenceDecision } from "@/lib/db/tool-policy-queries";
import { updateThreadStatus, addMessage, getThread } from "@/lib/db/thread-queries";
import { getChannel } from "@/lib/db/channel-queries";
import { notifyAdmin } from "@/lib/notifications";

export interface ToolExecutorDeps {
  addLog: typeof addLog;
  getUserById: typeof getUserById;
  getToolPolicy: typeof getToolPolicy;
  createApprovalRequest: typeof createApprovalRequest;
  updateThreadStatus: typeof updateThreadStatus;
  addMessage: typeof addMessage;
  getThread: typeof getThread;
  findApprovalPreferenceDecision: typeof findApprovalPreferenceDecision;
  getChannel: typeof getChannel;
  notifyAdmin: typeof notifyAdmin;
}

export const defaultToolExecutorDeps: ToolExecutorDeps = {
  addLog,
  getUserById,
  getToolPolicy,
  createApprovalRequest,
  updateThreadStatus,
  addMessage,
  getThread,
  findApprovalPreferenceDecision,
  getChannel,
  notifyAdmin,
};
