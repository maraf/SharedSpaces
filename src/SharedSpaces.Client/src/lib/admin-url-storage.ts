// Admin server URL history storage utilities for localStorage

const STORAGE_KEY_ADMIN_SERVER_URLS = 'sharedspaces:adminServerUrls';
const MAX_HISTORY_ENTRIES = 20;

/**
 * Get all stored admin server URLs
 * @returns Array of server URL strings (most recent first)
 */
export function getAdminServerUrls(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_ADMIN_SERVER_URLS);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    // Only keep string values
    return parsed.filter((item) => typeof item === 'string');
  } catch {
    return [];
  }
}

/**
 * Add an admin server URL to the history
 * @param url - Server URL to add (e.g., 'https://api.example.com')
 */
export function addAdminServerUrl(url: string): void {
  const trimmed = url.trim();
  if (!trimmed) return;

  const urls = getAdminServerUrls();
  // Remove existing occurrence to avoid duplicates
  const filtered = urls.filter((u) => u !== trimmed);
  // Add to front (most recent first)
  const updated = [trimmed, ...filtered];
  // Limit to max entries
  const limited = updated.slice(0, MAX_HISTORY_ENTRIES);

  localStorage.setItem(STORAGE_KEY_ADMIN_SERVER_URLS, JSON.stringify(limited));
}

/**
 * Remove an admin server URL from the history
 * @param url - Server URL to remove
 */
export function removeAdminServerUrl(url: string): void {
  const urls = getAdminServerUrls();
  const filtered = urls.filter((u) => u !== url);
  localStorage.setItem(STORAGE_KEY_ADMIN_SERVER_URLS, JSON.stringify(filtered));
}
