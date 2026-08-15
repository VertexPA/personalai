import "server-only";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  generateText,
  type FinishReason,
  type LanguageModel,
} from "ai";
import { z } from "zod";

import { serverEnv } from "@/lib/env";

export const llmProviderNames = [
  "openai",
  "anthropic",
  "openrouter",
] as const;

export type LlmProviderName = (typeof llmProviderNames)[number];

export interface LlmEnvironment {
  LLM_PROVIDER?: LlmProviderName;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
}

export interface LlmProviderConfiguration {
  provider: LlmProviderName;
  apiKey: string;
  model: string;
}

export class LlmConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "LlmConfigurationError";
  }
}

export class LlmGenerationError extends Error {
  public constructor() {
    super("The language model could not complete the request.");
    this.name = "LlmGenerationError";
  }
}

const generationRequestSchema = z.object({
  system: z.string().trim().min(1).max(8_000).optional(),
  prompt: z.string().trim().min(1).max(12_000),
  maxOutputTokens: z.number().int().min(64).max(2_000).optional(),
});

export type LlmGenerationRequest = z.infer<typeof generationRequestSchema>;

export interface LlmGenerationResult {
  provider: LlmProviderName;
  model: string;
  text: string;
  finishReason: FinishReason;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface LlmProvider {
  generate(request: LlmGenerationRequest): Promise<LlmGenerationResult>;
}

type GenerateTextRunner = typeof generateText;

function getRequiredValue(
  value: string | undefined,
  variableName: string,
): string {
  if (!value) {
    throw new LlmConfigurationError(
      variableName + " is required for the selected LLM provider.",
    );
  }

  return value;
}

/**
 * Resolves an explicit model and key only. There is intentionally no model
 * default: model selection is a deploy-time cost, capability, and data-policy
 * decision rather than an application-side surprise.
 */
export function resolveLlmProviderConfiguration(
  environment: LlmEnvironment,
): LlmProviderConfiguration | null {
  switch (environment.LLM_PROVIDER) {
    case undefined:
      return null;
    case "openai":
      return {
        provider: "openai",
        apiKey: getRequiredValue(environment.OPENAI_API_KEY, "OPENAI_API_KEY"),
        model: getRequiredValue(environment.OPENAI_MODEL, "OPENAI_MODEL"),
      };
    case "anthropic":
      return {
        provider: "anthropic",
        apiKey: getRequiredValue(
          environment.ANTHROPIC_API_KEY,
          "ANTHROPIC_API_KEY",
        ),
        model: getRequiredValue(environment.ANTHROPIC_MODEL, "ANTHROPIC_MODEL"),
      };
    case "openrouter":
      return {
        provider: "openrouter",
        apiKey: getRequiredValue(
          environment.OPENROUTER_API_KEY,
          "OPENROUTER_API_KEY",
        ),
        model: getRequiredValue(
          environment.OPENROUTER_MODEL,
          "OPENROUTER_MODEL",
        ),
      };
  }
}

function createLanguageModel(
  configuration: LlmProviderConfiguration,
): LanguageModel {
  switch (configuration.provider) {
    case "openai":
      return createOpenAI({ apiKey: configuration.apiKey })(configuration.model);
    case "anthropic":
      return createAnthropic({ apiKey: configuration.apiKey })(configuration.model);
    case "openrouter":
      return createOpenAICompatible({
        name: "openrouter",
        apiKey: configuration.apiKey,
        baseURL: "https://openrouter.ai/api/v1",
      })(configuration.model);
  }
}

export class AiSdkLlmProvider implements LlmProvider {
  private readonly model: LanguageModel;

  public constructor(
    private readonly configuration: LlmProviderConfiguration,
    private readonly runGeneration: GenerateTextRunner = generateText,
  ) {
    this.model = createLanguageModel(configuration);
  }

  async generate(request: LlmGenerationRequest): Promise<LlmGenerationResult> {
    const parsed = generationRequestSchema.parse(request);

    try {
      const result = await this.runGeneration({
        model: this.model,
        system: parsed.system,
        prompt: parsed.prompt,
        maxOutputTokens: parsed.maxOutputTokens ?? 800,
        maxRetries: 1,
        timeout: 20_000,
      });

      return {
        provider: this.configuration.provider,
        model: this.configuration.model,
        text: result.text,
        finishReason: result.finishReason,
        inputTokens: result.usage.inputTokens ?? null,
        outputTokens: result.usage.outputTokens ?? null,
      };
    } catch {
      throw new LlmGenerationError();
    }
  }
}

export function getServerLlmProvider(): LlmProvider | null {
  const configuration = resolveLlmProviderConfiguration(serverEnv);
  return configuration ? new AiSdkLlmProvider(configuration) : null;
}

export function getConfiguredLlmProviderName(): LlmProviderName | null {
  try {
    return resolveLlmProviderConfiguration(serverEnv)?.provider ?? null;
  } catch {
    return null;
  }
}
