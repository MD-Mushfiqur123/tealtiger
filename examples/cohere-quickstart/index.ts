/**
 * TealCohere Quickstart
 *
 * Demonstrates a guarded Cohere client using TealTiger's guardrails,
 * cost tracking, and budget management, with a RAG (Retrieval-Augmented
 * Generation) pattern using Cohere's Command model.
 *
 * Run with:
 *
 *   COHERE_API_KEY=... npx ts-node examples/cohere-quickstart/index.ts
 */

import {
  BudgetManager,
  ContentModerationGuardrail,
  CostTracker,
  GuardrailEngine,
  InMemoryCostStorage,
  PIIDetectionGuardrail,
} from 'tealtiger';
import { CohereClient } from 'cohere-ai';

const MODEL = 'command';

/**
 * Cohere pricing (per 1M tokens in USD).
 * Source: https://cohere.com/pricing
 */
const COHERE_PRICING: Record<string, { input: number; output: number }> = {
  'command': { input: 1.00, output: 2.00 },
  'command-light': { input: 0.30, output: 0.60 },
  'command-r': { input: 0.50, output: 1.50 },
  'command-r-plus': { input: 3.00, output: 15.00 },
};

// ── Guarded Cohere wrapper ──────────────────────────────────────

class GuardedCohere {
  private client: CohereClient;
  private guardrailEngine: GuardrailEngine;
  private costTracker: CostTracker;
  private budgetManager: BudgetManager;
  private costStorage: InMemoryCostStorage;
  private agentId: string;
  private model: string;

  constructor(config: {
    apiKey: string;
    agentId?: string;
    model?: string;
    guardrailEngine: GuardrailEngine;
    costTracker: CostTracker;
    budgetManager: BudgetManager;
    costStorage: InMemoryCostStorage;
  }) {
    this.client = new CohereClient({ token: config.apiKey });
    this.guardrailEngine = config.guardrailEngine;
    this.costTracker = config.costTracker;
    this.budgetManager = config.budgetManager;
    this.costStorage = config.costStorage;
    this.agentId = config.agentId || 'default-agent';
    this.model = config.model || 'command';
  }

  async chat(params: {
    message: string;
    model?: string;
    documents?: Array<{ title: string; snippet: string }>;
    maxTokens?: number;
  }) {
    const model = params.model || this.model;
    const inputText = params.message + (params.documents
      ? '\n\nDocs:\n' + params.documents.map(d => `${d.title}: ${d.snippet}`).join('\n')
      : '');

    // 1. Input guardrails
    const guardrailResult = await this.guardrailEngine.execute(inputText);
    if (!guardrailResult.passed) {
      const failed = guardrailResult.getFailedGuardrails().join(', ');
      throw new Error(`Guardrail blocked: ${failed}`);
    }

    // 2. Estimate cost & check budget
    const estimatedInputTokens = Math.ceil(inputText.length / 4);
    const estimatedOutputTokens = params.maxTokens || 200;
    const pricing = COHERE_PRICING[model] || COHERE_PRICING['command'];
    const estimatedInputCost = (estimatedInputTokens / 1_000_000) * pricing.input;
    const estimatedOutputCost = (estimatedOutputTokens / 1_000_000) * pricing.output;
    const estimatedCost = estimatedInputCost + estimatedOutputCost;

    const budgetCheck = await this.budgetManager.checkBudget(this.agentId, estimatedCost);
    if (!budgetCheck.allowed) {
      throw new Error(`Budget exceeded: $${budgetCheck.blockedBy?.limit}`);
    }

    // 3. Call Cohere API
    const requestParams: Record<string, any> = {
      message: params.message,
      model,
    };
    if (params.documents) requestParams.documents = params.documents;
    if (params.maxTokens) requestParams.maxTokens = params.maxTokens;

    const result = await this.client.chat(requestParams);

    // 4. Record actual cost
    const inputTokens = result.meta?.billedUnits?.inputTokens || 0;
    const outputTokens = result.meta?.billedUnits?.outputTokens || 0;
    const actualInputCost = (inputTokens / 1_000_000) * pricing.input;
    const actualOutputCost = (outputTokens / 1_000_000) * pricing.output;
    const actualCost = actualInputCost + actualOutputCost;

    const costRecord = {
      id: `cohere-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      requestId: result.generationId || '',
      agentId: this.agentId,
      model,
      provider: 'cohere' as const,
      timestamp: new Date().toISOString(),
      actualCost,
      estimatedCost,
      actualTokens: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
      estimatedTokens: { inputTokens: estimatedInputTokens, outputTokens: estimatedOutputTokens, totalTokens: estimatedInputTokens + estimatedOutputTokens },
    };

    await this.costStorage.store(costRecord);
    await this.budgetManager.recordCost(costRecord);

    return {
      text: result.text,
      citations: result.citations || [],
      documents: result.documents || [],
      cost: actualCost,
      tokens: { input: inputTokens, output: outputTokens },
    };
  }
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  // Guardrails
  const guardrailEngine = new GuardrailEngine();
  guardrailEngine.registerGuardrail(new PIIDetectionGuardrail({
    name: 'pii-detection',
    enabled: true,
    action: 'redact',
  }));
  guardrailEngine.registerGuardrail(new ContentModerationGuardrail({
    name: 'content-moderation',
    enabled: true,
    action: 'block',
    useOpenAI: false,
  }));

  // Cost tracking
  const costStorage = new InMemoryCostStorage();
  const costTracker = new CostTracker({
    enabled: true,
    persistRecords: true,
    enableBudgets: true,
    enableAlerts: true,
  });
  const budgetManager = new BudgetManager(costStorage);

  budgetManager.createBudget({
    name: 'Cohere Quickstart Daily Budget',
    limit: 5.0,
    period: 'daily',
    alertThresholds: [50, 75, 90],
    action: 'alert',
    enabled: true,
  });

  const client = new GuardedCohere({
    apiKey: process.env.COHERE_API_KEY || 'your-cohere-api-key',
    agentId: 'cohere-quickstart-agent',
    model: MODEL,
    guardrailEngine,
    costTracker,
    budgetManager,
    costStorage,
  });

  // 1. Basic request
  console.log('--- Basic Cohere request ---');
  const basic = await client.chat({
    message: 'In one sentence, what does TealTiger add around LLM calls?',
    maxTokens: 120,
  });
  console.log('Response:', basic.text);
  console.log(`Cost: $${basic.cost.toFixed(6)}`);
  console.log(`Tokens: ${basic.tokens.input} in / ${basic.tokens.output} out`);

  // 2. RAG request with documents
  console.log('\n--- RAG request with documents ---');
  const rag = await client.chat({
    message: 'What security features does TealTiger provide?',
    documents: [
      {
        title: 'TealTiger Overview',
        snippet: 'TealTiger is an AI security platform that provides guardrails, cost tracking, and policy management for LLM applications. It supports multiple providers including OpenAI, Anthropic, Google Gemini, AWS Bedrock, Azure OpenAI, Mistral AI, and Cohere.',
      },
      {
        title: 'Security Features',
        snippet: 'TealTiger includes TealGuard for content moderation, PII detection, and prompt injection prevention. TealEngine provides policy enforcement and TealCircuit implements circuit breaker patterns.',
      },
      {
        title: 'Cost Management',
        snippet: 'TealTiger tracks costs across all providers with real-time monitoring, budget management, and cost optimization recommendations. It helps teams control AI spending effectively.',
      },
    ],
  });
  console.log('Response:', rag.text);
  if (rag.citations.length > 0) {
    console.log('\nCitations:');
    for (const c of rag.citations) {
      console.log(`  - "${c.text}"`);
    }
  }
  console.log(`\nRAG cost: $${rag.cost.toFixed(6)}`);

  // 3. PII guardrail trigger
  console.log('\n--- PII guardrail request (will be redacted) ---');
  const guarded = await client.chat({
    message: 'Draft a support reply for Taylor at taylor@example.com without repeating the email address.',
    maxTokens: 120,
  });
  console.log('Response:', guarded.text);
  if (guarded.cost) {
    console.log(`Cost: $${guarded.cost.toFixed(6)}`);
  }

  // 4. Cost summary
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const summary = await costStorage.getSummary(today, new Date(), 'cohere-quickstart-agent');
  console.log('\n--- Cost summary ---');
  console.log(`Requests: ${summary.totalRequests}`);
  console.log(`Total cost: $${summary.totalCost.toFixed(6)}`);
}

main().catch((err) => {
  console.error('Cohere quickstart failed:', err);
  process.exit(1);
});
