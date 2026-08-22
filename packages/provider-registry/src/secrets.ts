export const SECRET_SERVICE = "glrs";
export const providerKeyAccount = (provider: string): string => `${provider}-api-key`;

export type SecretStore = {
  get: (service: string, account: string) => Promise<string | undefined>;
  set: (service: string, account: string, secret: string) => Promise<void>;
  delete: (service: string, account: string) => Promise<boolean>;
};

export class SecretStoreUnavailableError extends Error {
  constructor() {
    super("The operating-system credential store is unavailable.");
    this.name = "SecretStoreUnavailableError";
  }
}

type KeyringEntry = {
  getPassword: () => Promise<string | undefined>;
  setPassword: (secret: string) => Promise<void>;
  deleteCredential: () => Promise<boolean>;
};

type EntryFactory = (service: string, account: string) => KeyringEntry | Promise<KeyringEntry>;

const nativeEntry: EntryFactory = async (service, account) => {
  const { AsyncEntry } = await import("@napi-rs/keyring");
  return new AsyncEntry(service, account);
};

export const createSecretStore = (createEntry: EntryFactory = nativeEntry): SecretStore => ({
  async get(service, account) {
    if (!service || !account) throw new TypeError("Secret service and account must be nonempty.");
    try {
      return await (await createEntry(service, account)).getPassword();
    } catch {
      throw new SecretStoreUnavailableError();
    }
  },
  async set(service, account, secret) {
    if (!service || !account) throw new TypeError("Secret service and account must be nonempty.");
    try {
      await (await createEntry(service, account)).setPassword(secret);
    } catch {
      throw new SecretStoreUnavailableError();
    }
  },
  async delete(service, account) {
    if (!service || !account) throw new TypeError("Secret service and account must be nonempty.");
    try {
      return await (await createEntry(service, account)).deleteCredential();
    } catch {
      throw new SecretStoreUnavailableError();
    }
  },
});

const resolved = new Map<string, Promise<string | undefined>>();

// Reads only a provider explicitly marked as keychain-backed, and only once per
// process. A cancelled native prompt therefore cannot become a prompt loop.
export const providerKey = (
  provider: string,
  store: SecretStore = createSecretStore(),
): Promise<string | undefined> => {
  const existing = resolved.get(provider);
  if (existing) return existing;
  const reading = store.get(SECRET_SERVICE, providerKeyAccount(provider)).catch(() => undefined);
  resolved.set(provider, reading);
  return reading;
};

export const storeProviderKey = async (
  provider: string,
  secret: string,
  store: SecretStore = createSecretStore(),
): Promise<void> => {
  await store.set(SECRET_SERVICE, providerKeyAccount(provider), secret);
  resolved.set(provider, Promise.resolve(secret));
};

export const forgetProviderKey = (provider?: string): void => {
  if (provider === undefined) resolved.clear();
  else resolved.delete(provider);
};
