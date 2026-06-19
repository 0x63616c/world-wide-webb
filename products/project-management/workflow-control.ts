export const WORKFLOW_CONTROL_ACTIONS = ["pause", "resume", "retry", "mark-human"] as const;

export type WorkflowControlAction = (typeof WORKFLOW_CONTROL_ACTIONS)[number];

export type WorkflowControlRequest = {
  readonly ticketId: string;
  readonly action: WorkflowControlAction;
  readonly reason?: string;
};

export type WorkflowControlResult = {
  readonly ticketId: string;
  readonly workflowId: string;
  readonly action: WorkflowControlAction;
  readonly signaled: boolean;
};

export type WorkflowControlClient = {
  signalTicketWorkflow(request: WorkflowControlRequest): Promise<WorkflowControlResult>;
};

export type TemporalWorkflowControlOptions = {
  readonly address: string;
  readonly namespace: string;
};

const SIGNAL_BY_ACTION = {
  pause: "pauseTicketWorkflow",
  resume: "resumeTicketWorkflow",
  retry: "retryTicketWorkflow",
  "mark-human": "markTicketHumanWorkflow",
} as const satisfies Record<WorkflowControlAction, string>;

export function defaultTemporalWorkflowControlOptions(): TemporalWorkflowControlOptions {
  return {
    address: Bun.env.TEMPORAL_ADDRESS ?? "127.0.0.1:7233",
    namespace: Bun.env.TEMPORAL_NAMESPACE ?? "project-management",
  };
}

export function ticketWorkflowId(ticketId: string): string {
  return `ticket_${ticketId}`;
}

export function isWorkflowControlAction(action: string): action is WorkflowControlAction {
  return WORKFLOW_CONTROL_ACTIONS.some((candidate) => candidate === action);
}

export function createTemporalWorkflowControlClient(
  options = defaultTemporalWorkflowControlOptions(),
): WorkflowControlClient {
  let clientPromise: Promise<TemporalWorkflowClient> | null = null;

  return {
    async signalTicketWorkflow(request) {
      if (!clientPromise) clientPromise = connectTemporalWorkflowClient(options);
      const client = await clientPromise;
      const workflowId = ticketWorkflowId(request.ticketId);
      const signalName = SIGNAL_BY_ACTION[request.action];
      const args =
        request.action === "mark-human" ? [request.reason ?? "Marked human from UI"] : [];

      await client.signal(workflowId, signalName, args);
      return { ticketId: request.ticketId, workflowId, action: request.action, signaled: true };
    },
  };
}

type TemporalWorkflowClient = {
  signal(workflowId: string, signalName: string, args: readonly unknown[]): Promise<void>;
};

async function connectTemporalWorkflowClient(
  options: TemporalWorkflowControlOptions,
): Promise<TemporalWorkflowClient> {
  const temporal = await import("@temporalio/client");
  const connection = await temporal.Connection.connect({ address: options.address });
  const client = new temporal.Client({ connection, namespace: options.namespace });

  return {
    async signal(workflowId, signalName, args) {
      await client.workflow.getHandle(workflowId).signal(signalName, ...args);
    },
  };
}
