export function cn(...classes: (string | undefined | false | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

export function relativeTime(dateStr: string): string {
  if (!dateStr) return "never";
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} minutes ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours ago`;
  return `${Math.floor(diff / 86400000)} days ago`;
}

export function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export function formatSchedule(schedule: string): string {
  const map: Record<string, string> = {
    "0 */6 * * *": "Every 6 hours",
    "0 2 * * *": "Daily at 2:00 AM",
    "0 0 * * 1": "Weekly on Monday",
    "0 3 * * 0": "Weekly on Sunday",
    "0 4 * * 1": "Weekly on Monday",
  };
  return map[schedule] || schedule;
}
