import type { SecretProvider } from "./interface.ts";

// ReadFile dependency injected so tests don't touch the real filesystem.
type ReadFile = (path: string, encoding: "utf-8") => Promise<string>;

// Reads a secret from a local file. Useful for CI environments that mount
// secrets as files (Docker secrets, Kubernetes mounted secrets, etc.).
// Ref format: file:///absolute/path or file://relative/path
export class FileProvider implements SecretProvider {
  private readonly readFile: ReadFile;

  constructor(readFile: ReadFile) {
    this.readFile = readFile;
  }

  async resolve(ref: string): Promise<string> {
    // Strip the file:// scheme to get the filesystem path.
    const path = ref.replace(/^file:\/\//, "");
    const content = await this.readFile(path, "utf-8");
    return content.trim();
  }
}

// Default readFile using Node's fs/promises, used at runtime.
async function _makeDefaultReadFile(): Promise<ReadFile> {
  const { readFile } = await import("node:fs/promises");
  return readFile as ReadFile;
}
