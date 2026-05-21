export interface ModelOption {
  adapterType: 'anthropic' | 'gemini' | 'openai';
  endpoint?: string;
  label?: string;
  model: string;
}

export interface ModelSelectionOptions {
  defaultModel: string;
  modelOptions: ModelOption[];
}

export function getDefaultDocAgentModelOption(
  options: ModelSelectionOptions,
): ModelOption {
  const option = options.modelOptions.find(
    (item) => item.model === options.defaultModel,
  );
  if (!option) {
    throw new Error(
      `docusaurus-plugin-doc-agent defaultModel "${options.defaultModel}" must exist in modelOptions.`,
    );
  }
  return option;
}
