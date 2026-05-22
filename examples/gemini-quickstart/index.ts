/**
 * TealGemini Quickstart
 *
 * Demonstrates a guarded Gemini client with input guardrails,
 * a daily budget, and per-request cost tracking.
 *
 * Run with:
 *
 *   GEMINI_API_KEY=your-key npx ts-node examples/gemini-quickstart/index.ts
 */

import {
  BudgetManager,
  ContentModerationGuardrail,
  CostTracker,
  GuardrailEngine,
  InMemoryCostStorage,
  PIIDetectionGuardrail,
} from 'tealtiger';
import { TealGemini } from 'tealtiger/providers/gemini';

const MODEL = 'gemini-pro';

const GEMINI_PRICING: Record<string, { input: number; output: number }> = {
  'gemini-pro': { input: 0.000125, output: 0.000375 },
  'gemini-1.5-flash': { input: 0.000075, output: 0.000300 },
  'gemini-1.5-pro': { input: 0.001250, output: 0.005000 },
};

function createGuardrailEngine(): GuardrailEngine {
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

  return guardrailEngine;
}

function createCostTracker(): CostTracker {
  const costTracker = new CostTracker({
    enabled: true,
    persistRecords: true,
    enableBudgets: true,
    enableAlerts: true,
  });

  const pricing = GEMINI_PRICING[MODEL];
  costTracker.addCustomPricing(MODEL, {
    provider: 'google',
    inputCostPer1K: pricing.input,
    outputCostPer1K: pricing.output,
    lastUpdated: '2026-05-20',
  });

  return costTracker;
}

async function main() {
  const guardrailEngine = createGuardrailEngine();
  const costStorage = new InMemoryCostStorage();
  const costTracker = createCostTracker();
  const budgetManager = new BudgetManager(costStorage);

  budgetManager.createBudget({
    name: 'Gemini Quickstart Daily Budget',
    limit: 5.0,
    period: 'daily',
    alertThresholds: [50, 75, 90],
    action: 'alert',
    enabled: true,
  });

  const client = new TealGemini({
    apiKey: process.env.GEMINI_API_KEY || 'your-gemini-api-key',
    agentId: 'gemini-quickstart-agent',
    model: MODEL,
    guardrailEngine,
    costTracker,
    budgetManager,
    costStorage,
  });

  console.log('--- Basic Gemini request ---');
  const basic = await client.generateContent({
    model: MODEL,
    contents: [
      {
        role: 'user',
        parts: [{ text: 'In one sentence, what does TealTiger add around Gemini calls?' }],
      },
    ],
    generationConfig: {
      maxOutputTokens: 120,
    },
  });

  console.log('Response:', basic.text);
  if (basic.security?.costRecord) {
    console.log(`Cost: $${basic.security.costRecord.actualCost.toFixed(6)}`);
    console.log(`Tokens: ${basic.security.costRecord.actualTokens.totalTokens}`);
  }

  console.log('\n--- PII guardrail request ---');
  const guarded = await client.generateContent({
    model: MODEL,
    contents: [
      {
        role: 'user',
        parts: [{ text: 'Draft a support reply for Taylor at taylor@example.com without repeating the email address.' }],
      },
    ],
    generationConfig: {
      maxOutputTokens: 120,
    },
  });

  const inputGuardrails = guarded.security?.guardrailResult;
  const piiResult = inputGuardrails?.results.find(
    (result) => result.guardrailName === 'pii-detection',
  );
  const redactedText = piiResult?.result?.metadata?.redactedText;

  console.log('Guardrail summary:', inputGuardrails?.getSummary());
  if (redactedText) {
    console.log('Redacted input:', redactedText);
  }
  if (guarded.security?.costRecord) {
    console.log(`Cost: $${guarded.security.costRecord.actualCost.toFixed(6)}`);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const costSummary = await costStorage.getSummary(today, new Date(), 'gemini-quickstart-agent');

  console.log('\n--- Cost summary ---');
  console.log(`Requests tracked: ${costSummary.totalRequests}`);
  console.log(`Total cost: $${costSummary.totalCost.toFixed(6)}`);
}

main().catch((error) => {
  console.error('Gemini quickstart failed:', error);
  process.exit(1);
});
