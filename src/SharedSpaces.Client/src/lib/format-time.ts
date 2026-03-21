/**
 * Format a date as a relative time string using calendar days
 * 
 * @param date - The date to format
 * @returns Formatted string: "Today", "Yesterday", "Xd ago", or "Mar 19"
 */
export function formatRelativeTime(date: Date): string {
  const now = new Date();
  
  if (Number.isNaN(date.getTime())) return '';
  
  // Use UTC midnight from local Y/M/D parts to avoid DST affecting day diff
  const todayUtcMidnightMs = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const dateUtcMidnightMs = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  
  const diffMs = todayUtcMidnightMs - dateUtcMidnightMs;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  // Handle future dates within a week (e.g., due to clock skew) by treating them as "Today"
  // But dates far in future (7+ days) still use short date format
  if (diffDays < 0 && diffDays > -7) return 'Today';
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays >= 2 && diffDays < 7) return `${diffDays}d ago`;
  
  // 7+ days: show short date like "Mar 19"
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}
