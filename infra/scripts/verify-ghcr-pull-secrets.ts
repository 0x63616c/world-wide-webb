import { verifyLiveGhcrPullSecrets } from "../src/ghcr-pull-secret-preflight.ts";
import { GHCR_PULL_SECRET_NAME, GHCR_PULL_SECRET_NAMESPACES } from "../src/ghcr-pull-secrets.ts";

function main(): number {
  try {
    verifyLiveGhcrPullSecrets();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return 1;
  }

  console.log(
    `GHCR pull secret preflight passed for ${GHCR_PULL_SECRET_NAMESPACES.map((namespaceName) => `${namespaceName}/${GHCR_PULL_SECRET_NAME}`).join(", ")}`,
  );
  return 0;
}

process.exit(main());
