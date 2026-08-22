# @glrs-dev/glrs-ext-model-picker

Interactive `/model` picker for choosing the active model and reasoning effort through the public glrs extension API. It lists configured providers only; Ctrl+A opens provider setup and stores API keys in the operating-system credential store.

Azure DeepSeek entries use the built-in Azure adapter. The request hook remains for configurations using the legacy `azure-deepseek` OpenAI-compatible prefix.
