import { describe, expect, test } from "bun:test";
import {
  createSecretStore,
  forgetProviderKey,
  providerKey,
  SecretStoreUnavailableError,
  storeProviderKey,
} from "./secrets";

const entry = (
  over: Partial<{
    getPassword: () => Promise<string | undefined>;
    setPassword: (secret: string) => Promise<void>;
    deleteCredential: () => Promise<boolean>;
  }> = {},
) => ({
  getPassword: async () => undefined,
  setPassword: async () => {},
  deleteCredential: async () => false,
  ...over,
});

describe("OS credential storage", () => {
  test("reads a provider at most once per process", async () => {
    forgetProviderKey();
    let reads = 0;
    const store = createSecretStore(() =>
      entry({
        getPassword: async () => {
          reads += 1;
          return "secret";
        },
      }),
    );
    expect(await providerKey("openai", store)).toBe("secret");
    expect(await providerKey("openai", store)).toBe("secret");
    expect(reads).toBe(1);
    forgetProviderKey();
  });

  test("a failed or cancelled read is not retried during the process", async () => {
    forgetProviderKey();
    let reads = 0;
    const store = createSecretStore(() =>
      entry({
        getPassword: async () => {
          reads += 1;
          throw new Error("native prompt cancelled: do-not-leak");
        },
      }),
    );
    expect(await providerKey("anthropic", store)).toBeUndefined();
    expect(await providerKey("anthropic", store)).toBeUndefined();
    expect(reads).toBe(1);
    forgetProviderKey();
  });

  test("writes only after an explicit call and redacts native failures", async () => {
    forgetProviderKey();
    let written = "";
    const store = createSecretStore(() =>
      entry({
        setPassword: async (secret) => {
          written = secret;
        },
      }),
    );
    await storeProviderKey("openai", "top-secret", store);
    expect(written).toBe("top-secret");
    expect(await providerKey("openai", store)).toBe("top-secret");

    const failing = createSecretStore(() => {
      throw new Error("native details top-secret");
    });
    await expect(failing.get("glrs", "openai")).rejects.toEqual(new SecretStoreUnavailableError());
    forgetProviderKey();
  });
});
