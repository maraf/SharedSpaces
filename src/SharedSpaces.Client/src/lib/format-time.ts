/**
 * Format a date as a relative time string using calendar days
 * 
 * @param date - The date to format
 * @returns Formatted string: "Today", "Yesterday", "Xd ago", or "Mar 19"
 */
export function formatRelativeTime(date: Date): string {
  const now = new Date();
  
  // Normalize to start of day for calendar day comparison
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  
  const diffMs = todayStart.getTime() - dateStart.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  // Handle future dates (e.g., due to clock skew) by treating them as "Today"
  if (diffDays < 0) return 'Today';
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  
  // 7+ days: show short date like "Mar 19"
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}
