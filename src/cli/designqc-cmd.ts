import * as path from "node:path";
import { findProjectRoot } from "../scanner/project-root.js";
import { readJSON } from "../utils/fs-safe.js";
import { DesignQCEngine } from "../designqc/designqc-engine.js";
import type { DesignQCOptions, Viewport } from "../designqc/designqc-types.js";
import { DEFAULT_VIEWPORTS } from "../designqc/designqc-types.js";

interface DesignQCCliOpts {
  url?: string;
  routes?: string[];
  quality?: string;
  maxWidth?: string;
  desktopOnly?: boolean;
}

interface WolfConfig {
  openwolf?: {
    designqc?: {
      viewports?: Viewport[];
      max_screenshots?: number;
      chrome_path?: string | null;
    };
  };
}

export async function designqcCommand(
  target?: string,
  opts?: DesignQCCliOpts,
): Promise<void> {
  const projectRoot = findProjectRoot();
  const wolfDir = path.join(projectRoot, ".wolf");
  const config = readJSON<WolfConfig>(path.join(wolfDir, "config.json"), {});
  const dc = config.openwolf?.designqc ?? {};

  let viewports = dc.viewports || DEFAULT_VIEWPORTS;
  if (opts?.desktopOnly) {
    viewports = viewports.filter((v) => v.name === "desktop");
    if (viewports.length === 0) viewports = [DEFAULT_VIEWPORTS[0]];
  }

  const options: DesignQCOptions = {
    targetFile: target,
    devServerUrl: opts?.url,
    routes: opts?.routes,
    viewports,
    maxScreenshots: dc.max_screenshots || 16,
    chromePath: dc.chrome_path ?? undefined,
    quality: Number(opts?.quality) || 70,
    maxWidth: Number(opts?.maxWidth) || 1200,
  };

  console.log("\n  OpenWolf Design QC — Screenshot Capture\n");

  const engine = new DesignQCEngine(wolfDir, projectRoot, options);
  await engine.capture();
}
