import { describe, expect, it } from "vitest";

import {
  LlmConfigurationError,
  resolveLlmProviderConfiguration,
} from "@/lib/llm/provider";

describe("resolveLlmProviderConfiguration", () => {
  it("does not select a direct provider when none is configured", () => {
    expect(resolveLlmProviderConfiguration({})).toBeNull();
  });

  it("requires an explicit key and model for the selected provider", () => {
    expect(() =>
      resolveLlmProviderConfiguration({
        LLM_PROVIDER: "openai",
        OPENAI_API_KEY: "test-key",
      }),
    ).toThrow(LlmConfigurationError);
  });

  it.each([
    [
      {
        LLM_PROVIDER: "openai" as const,
        OPENAI_API_KEY: "openai-key",
        OPENAI_MODEL: "configured-openai-model",
      },
      "openai",
      "configured-openai-model",
    ],
    [
      {
        LLM_PROVIDER: "anthropic" as const,
        ANTHROPIC_API_KEY: "anthropic-key",
        ANTHROPIC_MODEL: "configured-anthropic-model",
      },
      "anthropic",
      "configured-anthropic-model",
    ],
    [
      {
        LLM_PROVIDER: "openrouter" as const,
        OPENROUTER_API_KEY: "openrouter-key",
        OPENROUTER_MODEL: "configured-openrouter-model",
      },
      "openrouter",
      "configured-openrouter-model",
    ],
  ])("selects %s without substituting a model default", (environment, provider, model) => {
    expect(resolveLlmProviderConfiguration(environment)).toMatchObject({
      provider,
      model,
    });
  });
});
