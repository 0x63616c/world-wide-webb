import { describe, expect, it, vi } from "vitest";
import { EnvProvider } from "../src/providers/env.ts";
import { FileProvider } from "../src/providers/file.ts";
import { OpProvider } from "../src/providers/op.ts";

// op provider: shells out to `op read <ref>`. Mock the child process so no
// real op session is needed in CI.
describe("OpProvider", () => {
  it("resolves an op:// reference by calling op read", async () => {
    const mockExec = vi.fn().mockResolvedValue({ stdout: "secret-value\n", stderr: "" });
    const provider = new OpProvider(mockExec);
    const value = await provider.resolve("op://Homelab/SomeItem/field");
    expect(mockExec).toHaveBeenCalledWith("op read op://Homelab/SomeItem/field");
    expect(value).toBe("secret-value");
  });

  it("trims trailing whitespace from op output", async () => {
    const mockExec = vi.fn().mockResolvedValue({ stdout: "  trimmed  \n", stderr: "" });
    const provider = new OpProvider(mockExec);
    const value = await provider.resolve("op://Homelab/Item/field");
    expect(value).toBe("trimmed");
  });

  it("rejects when op returns a non-empty stderr", async () => {
    const mockExec = vi.fn().mockResolvedValue({ stdout: "", stderr: "[ERROR] item not found" });
    const provider = new OpProvider(mockExec);
    await expect(provider.resolve("op://Homelab/Missing/field")).rejects.toThrow("op read failed");
  });
});

// file provider: reads the value from a local file path. The ref format is
// file:///absolute/path or file://relative/path.
describe("FileProvider", () => {
  it("resolves a file:// reference from a fixture file", async () => {
    const readFile = vi.fn().mockResolvedValue("file-secret\n");
    const provider = new FileProvider(readFile);
    const value = await provider.resolve("file:///tmp/secret.txt");
    expect(readFile).toHaveBeenCalledWith("/tmp/secret.txt", "utf-8");
    expect(value).toBe("file-secret");
  });

  it("trims whitespace from file content", async () => {
    const readFile = vi.fn().mockResolvedValue("  spaced  \r\n");
    const provider = new FileProvider(readFile);
    const value = await provider.resolve("file:///etc/secret");
    expect(value).toBe("spaced");
  });

  it("rejects when the file cannot be read", async () => {
    const readFile = vi.fn().mockRejectedValue(new Error("ENOENT: no such file"));
    const provider = new FileProvider(readFile);
    await expect(provider.resolve("file:///nonexistent")).rejects.toThrow("ENOENT");
  });
});

// env provider: reads the value from a named environment variable. The ref
// format is env://VAR_NAME.
describe("EnvProvider", () => {
  it("resolves an env:// reference from a provided env map", async () => {
    const provider = new EnvProvider({ MY_SECRET: "env-value" });
    const value = await provider.resolve("env://MY_SECRET");
    expect(value).toBe("env-value");
  });

  it("rejects when the env var is not set", async () => {
    const provider = new EnvProvider({});
    await expect(provider.resolve("env://MISSING_VAR")).rejects.toThrow(
      "env var MISSING_VAR not set",
    );
  });
});

// SecretProvider interface: verify all three providers satisfy it structurally.
describe("SecretProvider interface compliance", () => {
  it("OpProvider has a resolve method", () => {
    const provider = new OpProvider(vi.fn());
    expect(typeof provider.resolve).toBe("function");
  });

  it("FileProvider has a resolve method", () => {
    const provider = new FileProvider(vi.fn());
    expect(typeof provider.resolve).toBe("function");
  });

  it("EnvProvider has a resolve method", () => {
    const provider = new EnvProvider({});
    expect(typeof provider.resolve).toBe("function");
  });
});
