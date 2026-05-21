/**
 * TealTiger + LangChain integration example.
 *
 * This file is dependency-light so it can be compile-checked without
 * installing LangChain. The small interfaces below match the LangChain
 * shapes used by AgentExecutor, LCEL Runnables, and LangGraph nodes:
 *
 *   - agents/runnables expose invoke(input)
 *   - tools expose name, description, and invoke(input)
 *
 * In a real application, replace DemoLangChainAgent with your LangChain
 * AgentExecutor or compiled graph, and pass wrapped tools into the agent
 * during construction.
 */

import {
  CostTracker,
  GuardrailEngine,
  GuardrailEngineResult,
  InMemoryCostStorage,
  PIIDetectionGuardrail,
  TokenUsage,
} from 'tealtiger';

type AgentInput = {
  input: string;
};

type AgentOutput = {
  output: string;
  intermediateSteps?: ToolStep[];
};

type ToolStep = {
  tool: string;
  input: string;
  output: string;
};

type LangChainRunnable<Input, Output> = {
  invoke(input: Input, options?: Record<string, unknown>): Promise<Output> | Output;
};

type LangChainTool = {
  name: string;
  description: string;
  invoke(input: string): Promise<string> | string;
};

type GovernanceContext = {
  agentId: string;
  requestId: string;
  model: string;
};

class TealTigerLangChainMiddleware {
  constructor(
    private readonly guardrails: GuardrailEngine,
    private readonly costTracker: CostTracker,
    private readonly costStorage: InMemoryCostStorage,
  ) {}

  wrapAgent(
    agent: LangChainRunnable<AgentInput, AgentOutput>,
    context: GovernanceContext,
  ): LangChainRunnable<AgentInput, AgentOutput> {
    return {
      invoke: async (input, options) => {
        // Guardrail pass before the agent sees user input. With action=redact,
        // PII is scrubbed and the request continues with sanitized content.
        const inputCheck = await this.guardrails.execute(input.input, {
          ...context,
          phase: 'agent-input',
        });
        this.assertAllowed(inputCheck, 'agent input');

        const governedInput = {
          ...input,
          input: getRedactedText(inputCheck) || input.input,
        };

        const response = await agent.invoke(governedInput, options);

        // Guardrail pass on the final response before it reaches the caller.
        const outputCheck = await this.guardrails.execute(response.output, {
          ...context,
          phase: 'agent-output',
        });
        this.assertAllowed(outputCheck, 'agent output');

        return {
          ...response,
          output: getRedactedText(outputCheck) || response.output,
        };
      },
    };
  }

  wrapTool(tool: LangChainTool, context: GovernanceContext): LangChainTool {
    return {
      ...tool,
      invoke: async (input) => {
        // LangChain calls this wrapped tool from inside the agent loop, so
        // every tool call gets the same PII checks and cost accounting.
        const inputCheck = await this.guardrails.execute(input, {
          ...context,
          phase: 'tool-input',
          tool: tool.name,
        });
        this.assertAllowed(inputCheck, `${tool.name} input`);

        const governedInput = getRedactedText(inputCheck) || input;
        const startedAt = Date.now();
        const rawOutput = await tool.invoke(governedInput);

        const outputCheck = await this.guardrails.execute(rawOutput, {
          ...context,
          phase: 'tool-output',
          tool: tool.name,
        });
        this.assertAllowed(outputCheck, `${tool.name} output`);

        const governedOutput = getRedactedText(outputCheck) || rawOutput;
        const tokenUsage = estimateTokenUsage(governedInput, governedOutput);
        const costRecord = this.costTracker.calculateActualCost(
          `${context.requestId}:${tool.name}:${Date.now()}`,
          context.agentId,
          context.model,
          tokenUsage,
          'openai',
          {
            tool: tool.name,
            latencyMs: Date.now() - startedAt,
            integration: 'langchain',
          },
        );
        await this.costStorage.store(costRecord);

        return governedOutput;
      },
    };
  }

  private assertAllowed(result: GuardrailEngineResult, label: string): void {
    if (result.passed) {
      return;
    }

    throw new Error(
      `TealTiger blocked ${label}: ${result.failedGuardrails.join(', ')}`,
    );
  }
}

class StaticTool implements LangChainTool {
  constructor(
    public readonly name: string,
    public readonly description: string,
    private readonly handler: (input: string) => string,
  ) {}

  invoke(input: string): string {
    return this.handler(input);
  }
}

class DemoLangChainAgent implements LangChainRunnable<AgentInput, AgentOutput> {
  constructor(private readonly tools: LangChainTool[]) {}

  async invoke(input: AgentInput): Promise<AgentOutput> {
    const steps: ToolStep[] = [];

    for (const tool of this.tools) {
      const output = await tool.invoke(input.input);
      steps.push({
        tool: tool.name,
        input: input.input,
        output,
      });
    }

    return {
      output: [
        'The governed LangChain agent completed its workflow.',
        ...steps.map((step) => `${step.tool}: ${step.output}`),
      ].join('\n'),
      intermediateSteps: steps,
    };
  }
}

function getRedactedText(result: GuardrailEngineResult): string | undefined {
  for (const execution of result.results) {
    const redacted = execution.result?.metadata.redactedText;
    if (typeof redacted === 'string') {
      return redacted;
    }
  }

  return undefined;
}

function estimateTokenUsage(input: string, output: string): TokenUsage {
  const inputTokens = estimateTokens(input);
  const outputTokens = estimateTokens(output);

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

async function main(): Promise<void> {
  const guardrails = new GuardrailEngine();
  guardrails.registerGuardrail(new PIIDetectionGuardrail({
    name: 'pii-detection',
    enabled: true,
    action: 'redact',
    detectTypes: ['email', 'phone', 'ssn', 'creditCard'],
  }));

  const costStorage = new InMemoryCostStorage();
  const costTracker = new CostTracker({
    enabled: true,
    persistRecords: true,
    enableBudgets: true,
    enableAlerts: true,
  });

  const middleware = new TealTigerLangChainMiddleware(
    guardrails,
    costTracker,
    costStorage,
  );
  const context: GovernanceContext = {
    agentId: 'langchain-support-agent',
    requestId: 'langchain-demo-001',
    model: 'gpt-4',
  };

  const rawTools: LangChainTool[] = [
    new StaticTool(
      'ticket_search',
      'Search support tickets by customer hint',
      () => 'Found 2 open tickets related to billing and account access.',
    ),
    new StaticTool(
      'customer_lookup',
      'Look up customer profile data',
      () => 'Customer email is jane.customer@example.com and phone is 555-123-4567.',
    ),
  ];

  const governedTools = rawTools.map((tool) => middleware.wrapTool(tool, context));

  // In production, pass governedTools into createOpenAIFunctionsAgent(),
  // createToolCallingAgent(), AgentExecutor, or your LangGraph graph.
  const rawAgent = new DemoLangChainAgent(governedTools);
  const governedAgent = middleware.wrapAgent(rawAgent, context);

  const response = await governedAgent.invoke({
    input: 'Summarize Jane Customer account activity. Her email is jane.customer@example.com.',
  });

  console.log(response.output);

  const records = await costStorage.getByAgentId(context.agentId);
  const totalCost = records.reduce((sum, record) => sum + record.actualCost, 0);

  console.log('\nCost records by tool call:');
  for (const record of records) {
    console.log(
      `- ${record.metadata?.tool}: ${record.actualTokens.totalTokens} tokens, $${record.actualCost.toFixed(6)}`,
    );
  }
  console.log(`Total agent tool cost: $${totalCost.toFixed(6)}`);
}

main().catch((error) => {
  console.error('LangChain integration example failed:', error);
  process.exit(1);
});
