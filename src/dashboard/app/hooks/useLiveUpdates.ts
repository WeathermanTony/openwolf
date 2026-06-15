import { useEffect } from "react";
import type { WolfClient } from "../lib/wolf-client.js";

export function useLiveUpdates(
  client: WolfClient | null,
  type: string,
  callback: (msg: any) => void
): void {
  useEffect(() => {
    if (!client) return;
    return client.onMessage((msg) => {
      if (msg.type === type) callback(msg);
    });
  }, [client, type, callback]);
}
