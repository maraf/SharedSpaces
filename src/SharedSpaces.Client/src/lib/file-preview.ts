export type PreviewType = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'none';

const imageExtensions = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico',
]);

const videoExtensions = new Set(['mp4', 'webm']);

const audioExtensions = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac']);

const textExtensions = new Set([
  // Plain text
  'txt', 'log', 'csv', 'ini', 'conf',
  // Structured data
  'json', 'xml', 'yaml', 'yml', 'toml',
  // Markdown
  'md',
  // Code files
  'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'cs', 'go',
  'rs', 'php', 'rb', 'swift', 'kt', 'sh', 'bash', 'zsh',
  'html', 'css', 'scss', 'sass', 'less', 'sql',
]);

/**
 * Determines the preview type for a file based on its extension.
 * Returns 'none' for files that cannot be previewed in the browser.
 */
export function getPreviewType(filename: string): PreviewType {
  const ext = filename.toLowerCase().split('.').pop() || '';

  // No extension or filename is empty
  if (!ext || ext === filename.toLowerCase()) return 'none';

  if (imageExtensions.has(ext)) return 'image';
  if (videoExtensions.has(ext)) return 'video';
  if (audioExtensions.has(ext)) return 'audio';
  if (ext === 'pdf') return 'pdf';
  if (textExtensions.has(ext)) return 'text';

  return 'none';
}
