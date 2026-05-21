"""
TealTiger + LangChain integration example.

This file is dependency-light so it can pass a syntax check without installing
LangChain. The Protocols below mirror the LangChain shapes used by
AgentExecutor, LCEL Runnables, and LangGraph nodes:

    - agents/runnables expose ainvoke(input)
    - tools expose name, description, and ainvoke(input)

In a real application, replace DemoLangChainAgent with your LangChain
AgentExecutor or compiled graph, and pass wrapped tools into the agent during
construction.
"""

import asyncio
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Protocol

from tealtiger import (
    CostTracker,
    CostTrackerConfig,
    GuardrailEngine,
    InMemoryCostStorage,
    PIIDetectionGuardrail,
    TokenUsage,
)


class LangChainRunnable(Protocol):
    async def ainvoke(self, input_data: Dict[str, str]) -> Dict[str, Any]:
        """LangChain-compatible async invoke method."""


class LangChainTool(Protocol):
    name: str
    description: str

    async def ainvoke(self, input_data: str) -> str:
        """LangChain-compatible async tool invocation method."""


@dataclass(frozen=True)
class GovernanceContext:
    agent_id: str
    request_id: str
    model: str


class TealTigerLangChainMiddleware:
    def __init__(
        self,
        guardrails: GuardrailEngine,
        cost_tracker: CostTracker,
        cost_storage: InMemoryCostStorage,
    ) -> None:
        self.guardrails = guardrails
        self.cost_tracker = cost_tracker
        self.cost_storage = cost_storage

    def wrap_agent(
        self,
        agent: LangChainRunnable,
        context: GovernanceContext,
    ) -> LangChainRunnable:
        middleware = self

        class GovernedAgent:
            async def ainvoke(self, input_data: Dict[str, str]) -> Dict[str, Any]:
                # Guardrail pass before the agent sees user input. With
                # action=redact, PII is scrubbed and the request continues.
                input_check = await middleware.guardrails.execute(
                    input_data["input"],
                    {
                        "agent_id": context.agent_id,
                        "request_id": context.request_id,
                        "phase": "agent-input",
                    },
                )
                middleware._assert_allowed(input_check, "agent input")

                governed_input = dict(input_data)
                governed_input["input"] = (
                    _get_redacted_text(input_check) or input_data["input"]
                )

                response = await agent.ainvoke(governed_input)

                # Guardrail pass on the final response before it reaches the
                # caller.
                output = str(response.get("output", ""))
                output_check = await middleware.guardrails.execute(
                    output,
                    {
                        "agent_id": context.agent_id,
                        "request_id": context.request_id,
                        "phase": "agent-output",
                    },
                )
                middleware._assert_allowed(output_check, "agent output")

                governed_response = dict(response)
                governed_response["output"] = _get_redacted_text(output_check) or output
                return governed_response

        return GovernedAgent()

    def wrap_tool(
        self,
        tool: LangChainTool,
        context: GovernanceContext,
    ) -> LangChainTool:
        middleware = self

        class GovernedTool:
            name = tool.name
            description = tool.description

            async def ainvoke(self, input_data: str) -> str:
                # LangChain calls this wrapped tool from inside the agent loop,
                # so every tool call gets the same PII checks and cost records.
                input_check = await middleware.guardrails.execute(
                    input_data,
                    {
                        "agent_id": context.agent_id,
                        "request_id": context.request_id,
                        "phase": "tool-input",
                        "tool": tool.name,
                    },
                )
                middleware._assert_allowed(input_check, f"{tool.name} input")

                governed_input = _get_redacted_text(input_check) or input_data
                started_at = datetime.now(timezone.utc)
                raw_output = await tool.ainvoke(governed_input)

                output_check = await middleware.guardrails.execute(
                    raw_output,
                    {
                        "agent_id": context.agent_id,
                        "request_id": context.request_id,
                        "phase": "tool-output",
                        "tool": tool.name,
                    },
                )
                middleware._assert_allowed(output_check, f"{tool.name} output")

                governed_output = _get_redacted_text(output_check) or raw_output
                token_usage = _estimate_token_usage(governed_input, governed_output)
                cost_record = middleware.cost_tracker.calculate_actual_cost(
                    request_id=f"{context.request_id}:{tool.name}:{started_at.timestamp()}",
                    agent_id=context.agent_id,
                    model=context.model,
                    actual_tokens=token_usage,
                    provider="openai",
                    metadata={
                        "tool": tool.name,
                        "latency_ms": (
                            datetime.now(timezone.utc) - started_at
                        ).total_seconds() * 1000,
                        "integration": "langchain",
                    },
                )
                await middleware.cost_storage.store(cost_record)

                return governed_output

        return GovernedTool()

    def _assert_allowed(self, result: Any, label: str) -> None:
        if result.passed:
            return

        failed = ", ".join(result.failed_guardrails)
        raise RuntimeError(f"TealTiger blocked {label}: {failed}")


class StaticTool:
    def __init__(self, name: str, description: str, response: str) -> None:
        self.name = name
        self.description = description
        self.response = response

    async def ainvoke(self, input_data: str) -> str:
        del input_data
        return self.response


class DemoLangChainAgent:
    def __init__(self, tools: List[LangChainTool]) -> None:
        self.tools = tools

    async def ainvoke(self, input_data: Dict[str, str]) -> Dict[str, Any]:
        steps = []

        for tool in self.tools:
            output = await tool.ainvoke(input_data["input"])
            steps.append({
                "tool": tool.name,
                "input": input_data["input"],
                "output": output,
            })

        return {
            "output": "\n".join(
                [
                    "The governed LangChain agent completed its workflow.",
                    *[
                        f"{step['tool']}: {step['output']}"
                        for step in steps
                    ],
                ]
            ),
            "intermediate_steps": steps,
        }


def _get_redacted_text(result: Any) -> Optional[str]:
    for execution in result.results:
        guardrail_result = execution.get("result") or {}
        metadata = guardrail_result.get("metadata") or {}
        redacted = metadata.get("redacted_text")
        if isinstance(redacted, str):
            return redacted

    return None


def _estimate_token_usage(input_text: str, output_text: str) -> TokenUsage:
    input_tokens = _estimate_tokens(input_text)
    output_tokens = _estimate_tokens(output_text)
    return TokenUsage(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=input_tokens + output_tokens,
    )


def _estimate_tokens(text: str) -> int:
    return max(1, (len(text) + 3) // 4)


async def main() -> None:
    guardrails = GuardrailEngine()
    guardrails.register_guardrail(PIIDetectionGuardrail({
        "name": "pii-detection",
        "enabled": True,
        "action": "redact",
        "detect_types": ["email", "phone", "ssn", "credit_card"],
    }))

    cost_storage = InMemoryCostStorage()
    cost_tracker = CostTracker(CostTrackerConfig(
        enabled=True,
        persist_records=True,
        enable_budgets=True,
        enable_alerts=True,
    ))

    middleware = TealTigerLangChainMiddleware(
        guardrails,
        cost_tracker,
        cost_storage,
    )
    context = GovernanceContext(
        agent_id="langchain-support-agent",
        request_id="langchain-demo-001",
        model="gpt-4",
    )

    raw_tools: List[LangChainTool] = [
        StaticTool(
            "ticket_search",
            "Search support tickets by customer hint",
            "Found 2 open tickets related to billing and account access.",
        ),
        StaticTool(
            "customer_lookup",
            "Look up customer profile data",
            "Customer email is jane.customer@example.com and phone is 555-123-4567.",
        ),
    ]
    governed_tools = [
        middleware.wrap_tool(tool, context)
        for tool in raw_tools
    ]

    # In production, pass governed_tools into create_openai_functions_agent(),
    # create_tool_calling_agent(), AgentExecutor, or your LangGraph graph.
    raw_agent = DemoLangChainAgent(governed_tools)
    governed_agent = middleware.wrap_agent(raw_agent, context)

    response = await governed_agent.ainvoke({
        "input": (
            "Summarize Jane Customer account activity. Her email is "
            "jane.customer@example.com."
        ),
    })
    print(response["output"])

    now = datetime.now(timezone.utc)
    records = await cost_storage.get_by_date_range(
        now - timedelta(minutes=5),
        now + timedelta(minutes=5),
    )
    total_cost = sum(record.actual_cost for record in records)

    print("\nCost records by tool call:")
    for record in records:
        metadata = record.metadata or {}
        print(
            "- {tool}: {tokens} tokens, ${cost:.6f}".format(
                tool=metadata.get("tool"),
                tokens=record.actual_tokens.total_tokens,
                cost=record.actual_cost,
            )
        )
    print(f"Total agent tool cost: ${total_cost:.6f}")


if __name__ == "__main__":
    asyncio.run(main())
