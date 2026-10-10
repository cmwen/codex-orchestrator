export type Workspace = {
  id: string;
  name: string;
  path: string;
  documents: { name: string; text: string }[];
  indexedAt: string;
};
export type Decision = {
  workspaceId: string;
  workspaceName: string;
  model: string;
  effort: string;
  confidence: number;
  reason: string;
  decisionModel: string;
  durationMs: number;
  sources: string[];
  decidedAt: string;
};
export type Approval = {
  id: number;
  method: string;
  params: {
    reason?: string;
    command?: string;
    availableDecisions?: string[];
    networkApprovalContext?: { host: string; protocol: string };
    questions?: {
      id: string;
      question: string;
      isSecret: boolean;
      options?: { label: string; description: string }[];
    }[];
  };
};
export type Session = {
  id: string;
  title: string;
  status: string;
  archived: boolean;
  workspaceId?: string;
  workspaceName?: string;
  workspacePath?: string;
  threadId?: string;
  error?: string;
  updatedAt: string;
  decisions: Decision[];
  messages: { id: string; role: string; text: string }[];
  activity: {
    id: string;
    type: string;
    status: string;
    command?: string;
    text?: string;
    output?: string;
    changes?: { path: string; diff: string }[];
  }[];
  approvals: Approval[];
  diff?: string;
};
export type AppState = {
  workspaces: Workspace[];
  sessions: Session[];
  config: { routerUrl: string; decisionModel: string };
  codexConnected: boolean;
};
