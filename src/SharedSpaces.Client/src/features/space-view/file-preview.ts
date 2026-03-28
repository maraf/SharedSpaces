/**
 * Determines the preview type for a given filename based on its extension.
 * Used to decide how to render file previews in the space view.
 */

export type FilePreviewType = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'none';

const IMAGE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico',
]);

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm']);

const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac']);

const TEXT_EXTENSIONS = new Set([
  // Plain text
  'txt', 'log', 'csv', 'ini', 'conf',
  // Structured data
  'json', 'xml', 'yaml', 'yml', 'toml',
  // Markdown
  'md',
  // Code
  'js', 'ts', 'py', 'java', 'cs', 'go', 'rs', 'rb', 'php', 'swift', 'kt',
  'c', 'cpp', 'h', 'hpp', 'css', 'scss', 'html',
]);

/** Max file sizes for preview (bytes) */
export const PREVIEW_SIZE_LIMITS: Record<FilePreviewType, number> = {
  image: 10 * 1024 * 1024,   // 10 MB
  video: 100 * 1024 * 1024,  // 100 MB
  audio: 50 * 1024 * 1024,   // 50 MB
  pdf: 20 * 1024 * 1024,     // 20 MB
  text: 1 * 1024 * 1024,     // 1 MB
  none: 0,
};

function getExtension(filename: string): string {
  return filename.toLowerCase().split('.').pop() || '';
}

export function getFilePreviewType(filename: string): FilePreviewType {
  const ext = getExtension(filename);

  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  if (ext === 'pdf') return 'pdf';
  if (TEXT_EXTENSIONS.has(ext)) return 'text';

  return 'none';
}

export function isPreviewable(filename: string): boolean {
  return getFilePreviewType(filename) !== 'none';
}

export function isFileTooLargeForPreview(filename: string, fileSize: number): boolean {
  const type = getFilePreviewType(filename);
  if (type === 'none') return false;
  return fileSize > PREVIEW_SIZE_LIMITS[type];
}
