export interface DesignQCOptions {
  targetFile?: string;
  devServerUrl?: string;
  routes?: string[];
  viewports?: Viewport[];
  maxScreenshots: number;
  chromePath?: string;
  quality: number;
  maxWidth: number;
}

export interface Viewport {
  name: string;
  width: number;
  height: number;
}

export interface Screenshot {
  route: string;
  viewport: Viewport;
  path: string;
}

export interface CaptureResult {
  screenshots: Screenshot[];
  captureDir: string;
  totalSizeKB: number;
  estimatedTokens: number;
}

export const DEFAULT_VIEWPORTS: Viewport[] = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 375, height: 812 },
];
