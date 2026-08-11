import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const keychainService = "glorious";

const accountFor = (provider: string): string => `${provider}-api-key`;

type KeychainCommand = (args: string[]) => Promise<string>;

const keychain: KeychainCommand = async (args) => {
  if (process.platform !== "darwin")
    throw new Error("Provider keys currently require the macOS Keychain.");
  return (await execFile("security", args)).stdout.trim();
};

export const createProviderKeyStore = (command: KeychainCommand = keychain) => {
  const keys = new Map<string, Promise<string | undefined>>();

  const get = (provider: string): Promise<string | undefined> => {
    const cached = keys.get(provider);
    if (cached) return cached;
    const value = command([
      "find-generic-password",
      "-a",
      accountFor(provider),
      "-s",
      keychainService,
      "-w",
    ]).catch(() => undefined);
    keys.set(provider, value);
    return value;
  };

  const save = async (provider: string, key: string): Promise<void> => {
    if (key.trim() === "") throw new Error("API key cannot be empty.");
    try {
      await command([
        "add-generic-password",
        "-U",
        "-a",
        accountFor(provider),
        "-s",
        keychainService,
        "-w",
        key,
      ]);
      keys.set(provider, Promise.resolve(key));
    } catch (thrown) {
      throw new Error(
        `Unable to access the macOS Keychain: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
      );
    }
  };

  return { get, save };
};

const providerKeys = createProviderKeyStore();

export const providerKey = providerKeys.get;
export const saveProviderKey = providerKeys.save;
