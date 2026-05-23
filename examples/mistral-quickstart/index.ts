/**
 * TealMistral Quickstart
 *
 * Demonstrates a guarded Mistral AI client with input guardrails,
 * a daily budget, and per-request cost tracking.
 *
 * Run with:
 *
 *   MISTRAL_API_KEY=your-key npx ts-node examples/mistral-quickstart/index.ts
 */

import {
  BudgetManager,
  CostTracker,
  GuardrailEngine,
  InMemoryCostStorage,
  PIIDetectionGuardrail,
  PromptInjectionGuardrail,
} from 'tealtiger';
import { TealMistral, MISTRAL_PRICING } from 'tealtiger/providers/mistral';

const MODEL = 'mistral-large-latest';

const MISTRAL_PRICING_PER_1K: Record<string, { input: number; output: number }> = {};
for (const [model, p] of Object.entries(MISTRAL_PRICING)) {
  MISTRAL_PRICING_PER_1K[model] = {
    input: p.input / 1000,
    output: p.output / 1000,
  };
}

function createGuardrailEngine(): GuardrailEngine {
  const guardrailEngine = new GuardrailEngine();

  guardrailEngine.registerGuardrail(new PIIDetectionGuardrail({
    name: 'pii-detection',
    enabled: true,
    action: 'redact',
  }));

  guardrailEngine.registerGuardrail(new PromptInjectionGuardrail({
    name: 'prompt-injection',
    enabled: true,
    action: 'block',
    sensitivity: 'medium',
  }));

  return guardrailEngine;
}

function createCostTracker(): CostTracker {
  const costTracker = new CostTracker({
    enabled: true,
    persistRecords: true,
    enableBudgets: true,
    enableAlerts: true,
  });

  const pricing = MISTRAL_PRICING_PER_1K[MODEL];
  costTracker.addCustomPricing(MODEL, {
    provider: 'mistral',
    inputCostPer1K: pricing.input,
    outputCostPer1K: pricing.output,
    lastUpdated: '2026-05-23',
  });

  return costTracker;
}

async function main() {
  const guardrailEngine = createGuardrailEngine();
  const costStorage = new InMemoryCostStorage();
  const costTracker = createCostTracker();
  const budgetManager = new BudgetManager(costStorage);

  budgetManager.createBudget({
    name: 'Mistral Quickstart Daily Budget',
    limit: 5.0,
    period: 'daily',
    alertThresholds: [50, 75, 90],
    action: 'alert',
    enabled: true,
  });

  const client = new TealMistral({
    mistralApiKey: process.env.MISTRAL_API_KEY || 'your-mistral-api-key',
    agentId: 'mistral-quickstart-agent',
    model: MODEL,
  });

  console.log('--- Basic Mistral request ---');
  const basicInput = 'In one sentence, what does TealTiger add around Mistral AI calls?';

  const basicGuardrails = await guardrailEngine.execute(basicInput);
  if (!basicGuardrails.passed) {
    throw new Error(`Input guardrail check failed: ${basicGuardrails.getFailedGuardrails().join(', ')}`);
  }

  const basic = await client.chat.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: 'You are a concise security engineer.',
      },
      {
        role: 'user',
        content: basicInput,
      },
    ],
    max_tokens: 120,
  });

  const basicText = basic.choices[0].message.content;
  console.log('Response:', basicText);

  if (basic.usage) {
    const costRecord = costTracker.calculateActualCost(
      'basic-' + Date.now(),
      'mistral-quickstart-agent',
      MODEL,
      {
        inputTokens: basic.usage.prompt_tokens,
        outputTokens: basic.usage.completion_tokens,
        totalTokens: basic.usage.total_tokens,
      },
      'mistral'
    );
    await costStorage.store(costRecord);
    console.log(`Cost: $${costRecord.actualCost.toFixed(6)}`);
    console.log(`Tokens: ${costRecord.actualTokens.totalTokens}`);
  }

  console.log('\n--- PII guardrail request ---');
  const guardedInput = 'Draft a support reply for Taylor at taylor@example.com without repeating the email address.';

  const inputGuardrails = await guardrailEngine.execute(guardedInput);
  const piiResult = inputGuardrails.results.find(
    (result) => result.guardrailName === 'pii-detection',
  );

  console.log('Guardrail summary:', inputGuardrails.getSummary());
  if (piiResult?.result?.metadata?.redactedText) {
    console.log('Redacted input:', piiResult.result.metadata.redactedText);
  }

  if (inputGuardrails.passed) {
    const guarded = await client.chat.create({
      model: MODEL,
      messages: [
        {
          role: 'user',
          content: guardedInput,
        },
      ],
      max_tokens: 120,
    });

    if (guarded.usage) {
      const costRecord = costTracker.calculateActualCost(
        'guarded-' + Date.now(),
        'mistral-quickstart-agent',
        MODEL,
        {
          inputTokens: guarded.usage.prompt_tokens,
          outputTokens: guarded.usage.completion_tokens,
          totalTokens: guarded.usage.total_tokens,
        },
        'mistral'
      );
      await costStorage.store(costRecord);
      console.log(`Cost: $${costRecord.actualCost.toFixed(6)}`);
    }
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const costSummary = await costStorage.getSummary(today, new Date(), 'mistral-quickstart-agent');

  console.log('\n--- Cost summary ---');
  console.log(`Requests tracked: ${costSummary.totalRequests}`);
  console.log(`Total cost: $${costSummary.totalCost.toFixed(6)}`);
}

main().catch((error) => {
  console.error('Mistral quickstart failed:', error);
  process.exit(1);
});
