/**
 * LangChain governance example with TealEngine.
 *
 * The example models the security boundary around LangChain tool calls:
 * 1. A LangChain tool-calling agent chooses tools.
 * 2. Each tool wrapper evaluates the call with TealEngine before execution.
 * 3. Allowed tool calls execute normally.
 * 4. Denied tool calls return a blocked result without running the tool body.
 * 5. LangChain model token usage is recorded with TealTiger cost tracking.
 *
 * Run from the repository root with:
 *
 *   npx ts-node examples/langchain-governance/index.ts
 */

const AGENT_ID = 'langchain-governance-demo-agent';
const RUN_ID = `langchain-demo-${Date.now()}`;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

if (!process.env.OPENAI_API_KEY) {
  console.error('LangChain governance example failed: Error: OPENAI_API_KEY is required to run the LangChain governance example.');
  process.exit(1);
}

const { ChatOpenAI } = require('@langchain/openai');
const { tool, createAgent } = require('langchain');
const z = require('zod');
const {
  BudgetManager,
  CostTracker,
  ContextManager,
  InMemoryCostStorage,
  TealEngine,
} = require('tealtiger');

type ToolCallInput = Record<string, unknown>;

type GovernedToolSpec = {
  name: string;
  description: string;
  execute: (input: ToolCallInput) => Promise<string> | string;
};

const engine = new TealEngine(
  {
    identity: {
      agentId: AGENT_ID,
      role: 'support-agent',
      permissions: ['read:docs'],
      forbidden: ['delete:customer'],
    },
    tools: {
      search_docs: { allowed: true },
      delete_customer: { allowed: false },
    },
    behavioral: {
      costLimit: {
        daily: 5.0,
        hourly: 1.0,
      },
      rateLimit: {
        requests: 20,
        window: '1h',
      },
    },
  },
  {
    mode: { default: 'ENFORCE' },
  } as any,
);

const executionContext = ContextManager.createContext({
  application: 'langchain-governance-example',
  environment: 'development',
  run_id: RUN_ID,
});

const costStorage = new InMemoryCostStorage();
const costTracker = new CostTracker({
  enabled: true,
  persistRecords: true,
  enableBudgets: true,
  enableAlerts: true,
});
const budgetManager = new BudgetManager(costStorage);

costTracker.addCustomPricing(MODEL, {
  model: MODEL,
  provider: 'openai',
  inputCostPer1K: 0.00015,
  outputCostPer1K: 0.0006,
  lastUpdated: '2026-05-22',
});

budgetManager.createBudget({
  name: 'LangChain Governance Demo Budget',
  limit: 5.0,
  period: 'daily',
  alertThresholds: [50, 75, 90, 100],
  action: 'alert',
  enabled: true,
});

let governedToolCalls = 0;
let trackedModelCostUsd = 0;

function reasonCodes(decision: any): string[] {
  return decision.reason_codes || decision.reasonCodes || [];
}

function evaluateToolCall(toolName: string, toolArgs: ToolCallInput) {
  return engine.evaluateWithMode(
    {
      agentId: AGENT_ID,
      action: 'tool.execute',
      tool: toolName,
      toolParams: toolArgs,
      metadata: {
        run_id: RUN_ID,
        environment: 'development',
      },
    },
    executionContext,
  );
}

function createGovernedTool(spec: GovernedToolSpec) {
  return async (input: ToolCallInput): Promise<string> => {
    const decision = evaluateToolCall(spec.name, input);
    const codes = reasonCodes(decision);

    governedToolCalls += 1;
    console.log(`[TealTiger] ${decision.action} tool=${spec.name} reasons=${codes.join(',')}`);

    if (decision.action === 'DENY') {
      return `TealTiger DENY: ${spec.name} was blocked before execution. Reason: ${decision.reason}`;
    }

    return spec.execute(input);
  };
}

function extractTokenUsage(output: any): { inputTokens: number; outputTokens: number } | undefined {
  const usage = output?.llmOutput?.tokenUsage || output?.llmOutput?.usage;
  const inputTokens = usage?.promptTokens || usage?.prompt_tokens || usage?.input_tokens;
  const outputTokens = usage?.completionTokens || usage?.completion_tokens || usage?.output_tokens;

  if (typeof inputTokens !== 'number' || typeof outputTokens !== 'number') {
    return undefined;
  }

  return { inputTokens, outputTokens };
}

async function recordModelUsage(inputTokens: number, outputTokens: number): Promise<void> {
  const record = costTracker.calculateActualCost(
    `${RUN_ID}-llm-${Date.now()}`,
    AGENT_ID,
    MODEL,
    {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    },
    'openai',
    { runId: RUN_ID },
  );

  await costStorage.store(record);
  await budgetManager.recordCost(record);
  trackedModelCostUsd += record.actualCost;
}

const searchDocs = tool(
  createGovernedTool({
    name: 'search_docs',
    description: 'Search public TealTiger documentation. This read-only tool is allowed.',
    execute: ({ query }) => {
      return `Docs result for "${query}": TealTiger evaluates each LangChain tool call before side effects.`;
    },
  }),
  {
    name: 'search_docs',
    description: 'Search public TealTiger documentation. This read-only tool is allowed.',
    schema: z.object({
      query: z.string().describe('Short documentation search query.'),
    }),
  },
);

const deleteCustomer = tool(
  createGovernedTool({
    name: 'delete_customer',
    description: 'Delete a customer account. This destructive tool is denied by policy.',
    execute: ({ customer_id }) => {
      return `Deleted customer ${customer_id}`;
    },
  }),
  {
    name: 'delete_customer',
    description: 'Delete a customer account. This destructive tool is denied by policy.',
    schema: z.object({
      customer_id: z.string().describe('Customer identifier to delete.'),
    }),
  },
);

async function main(): Promise<void> {
  const model = new ChatOpenAI({
    model: MODEL,
    temperature: 0,
    callbacks: [
      {
        handleLLMEnd: async (output) => {
          const usage = extractTokenUsage(output);
          if (usage) {
            await recordModelUsage(usage.inputTokens, usage.outputTokens);
          }
        },
      },
    ],
  });

  const agent = createAgent({
    model,
    tools: [searchDocs, deleteCustomer],
    systemPrompt: [
      'You are a deterministic governance demo agent.',
      'First call search_docs with query "TealTiger LangChain governance".',
      'Then call delete_customer with customer_id "cus_demo_123".',
      'Finally summarize which tool was allowed and which tool was denied.',
    ].join(' '),
  });

  const result = await agent.invoke({
    messages: [
      {
        role: 'user',
        content: 'Demonstrate TealTiger governance around LangChain tool calls.',
      },
    ],
  } as any);

  const latestMessage = result.messages?.[result.messages.length - 1];

  console.log('\nAgent output:');
  console.log(latestMessage?.content || JSON.stringify(result, null, 2));
  console.log('\nCost summary:');
  console.log({
    model: MODEL,
    governedToolCalls,
    trackedModelCostUsd: trackedModelCostUsd.toFixed(6),
  });
}

main().catch((error) => {
  console.error('LangChain governance example failed:', error);
  process.exitCode = 1;
});
