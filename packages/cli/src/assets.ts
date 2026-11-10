import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface RelayAssets {
  template: string;
  bundle: string;
}

/**
 * Locate the relay bundle and CloudFormation template relative to this module.
 * Published/bundled (`dist/bin.mjs`): `dist/relay/{index.mjs,template.yaml}` next to the module.
 * Repo checkout (`src/*.ts`): `packages/relay/{template.yaml,dist/index.mjs}`.
 */
export function resolveRelayAssets(moduleUrl: string): RelayAssets {
  const packaged = (name: string): string => fileURLToPath(new URL(`./relay/${name}`, moduleUrl));
  if (existsSync(packaged("template.yaml"))) {
    return { template: packaged("template.yaml"), bundle: packaged("index.mjs") };
  }
  const repo = (path: string): string => fileURLToPath(new URL(`../../relay/${path}`, moduleUrl));
  return { template: repo("template.yaml"), bundle: repo("dist/index.mjs") };
}
