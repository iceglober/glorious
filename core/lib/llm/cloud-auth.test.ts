import { describe, expect, test } from "bun:test";
import {
  type CloudAuthEnv,
  describeAuthError,
  detectCloudAuth,
  isCloudAuthProvider,
} from "./cloud-auth";

const deps = (over: Partial<CloudAuthEnv> = {}): CloudAuthEnv => ({
  env: {},
  fileExists: () => false,
  which: () => false,
  home: "/home/u",
  ...over,
});

describe("detectCloudAuth · vertex", () => {
  test("no ADC and no CLI → not present, offers the login command + defaults", () => {
    const s = detectCloudAuth("vertex", deps());
    expect(s.credsPresent).toBe(false);
    expect(s.cliAvailable).toBe(false);
    expect(s.loginArgv).toEqual(["gcloud", "auth", "application-default", "login"]);
    expect(s.params.map((p) => p.key)).toEqual(["project", "location"]);
    expect(s.params.find((p) => p.key === "location")?.value).toBe("global"); // default
  });

  test("the ADC file present → creds detected; gcloud on PATH → runnable", () => {
    const s = detectCloudAuth("vertex", {
      ...deps({ which: (c) => c === "gcloud" }),
      fileExists: (p) => p === "/home/u/.config/gcloud/application_default_credentials.json",
    });
    expect(s.credsPresent).toBe(true);
    expect(s.cliAvailable).toBe(true);
  });

  test("env sniffs the project + an explicit key file counts as creds", () => {
    const s = detectCloudAuth(
      "vertex",
      deps({
        env: {
          GOOGLE_APPLICATION_CREDENTIALS: "/keys/sa.json",
          GOOGLE_CLOUD_PROJECT: "acme-prod",
        },
      }),
    );
    expect(s.credsPresent).toBe(true);
    expect(s.params.find((p) => p.key === "project")?.value).toBe("acme-prod");
  });
});

describe("detectCloudAuth · bedrock", () => {
  test("static keys count as creds; region defaults", () => {
    const s = detectCloudAuth(
      "bedrock",
      deps({ env: { AWS_ACCESS_KEY_ID: "AKIA", AWS_SECRET_ACCESS_KEY: "s3cr3t" } }),
    );
    expect(s.credsPresent).toBe(true);
    expect(s.params.find((p) => p.key === "region")?.value).toBe("us-east-1");
  });

  test("an access key without its secret is not enough", () => {
    const s = detectCloudAuth("bedrock", deps({ env: { AWS_ACCESS_KEY_ID: "AKIA" } }));
    expect(s.credsPresent).toBe(false);
  });

  test("a profile scopes the SSO login command and counts as creds", () => {
    const s = detectCloudAuth(
      "bedrock",
      deps({ env: { AWS_PROFILE: "prod", AWS_REGION: "eu-west-1" } }),
    );
    expect(s.credsPresent).toBe(true);
    expect(s.loginArgv).toEqual(["aws", "sso", "login", "--profile", "prod"]);
    expect(s.params.find((p) => p.key === "region")?.value).toBe("eu-west-1");
  });

  test("container/ECS credentials count as creds", () => {
    const s = detectCloudAuth(
      "bedrock",
      deps({ env: { AWS_CONTAINER_CREDENTIALS_FULL_URI: "http://localhost:9911/creds" } }),
    );
    expect(s.credsPresent).toBe(true);
  });

  test("the shared credentials file counts as creds", () => {
    const s = detectCloudAuth("bedrock", {
      ...deps(),
      fileExists: (p) => p === "/home/u/.aws/credentials",
    });
    expect(s.credsPresent).toBe(true);
    expect(s.loginArgv).toEqual(["aws", "sso", "login"]);
  });
});

describe("describeAuthError", () => {
  test("Google invalid_rapt → a re-auth instruction", () => {
    const raw = `{"error":"invalid_grant","error_description":"reauth related error (invalid_rapt)","error_subtype":"invalid_rapt"}`;
    expect(describeAuthError(raw)).toContain("gcloud auth application-default login");
  });

  test("AWS SSO expiry → an aws sso login instruction", () => {
    expect(describeAuthError("The SSO session's token has expired")).toContain("aws sso login");
  });

  test("a Vertex model-not-in-region error points at the global location", () => {
    const raw =
      "Publisher model `projects/p/locations/us-central1/publishers/google/models/gemini-3.1-pro-preview` was not found or your project does not have access to it.";
    const out = describeAuthError(raw);
    expect(out).toContain('"gemini-3.1-pro-preview"');
    expect(out).toContain('location "us-central1"');
    expect(out).toContain("global");
  });

  test("an unrelated error is left for the caller (undefined)", () => {
    expect(describeAuthError("ECONNRESET while reading model output")).toBeUndefined();
  });
});

test("isCloudAuthProvider flags only bedrock + vertex", () => {
  expect(isCloudAuthProvider("bedrock")).toBe(true);
  expect(isCloudAuthProvider("vertex")).toBe(true);
  expect(isCloudAuthProvider("azure")).toBe(false);
  expect(isCloudAuthProvider("openai")).toBe(false);
});
