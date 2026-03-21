import { html } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import type { TemplateResult } from 'lit';

// Import SVGs from bootstrap-icons package at build time
import fileEarmarkImageSvg from 'bootstrap-icons/icons/file-earmark-image.svg?raw';
import fileEarmarkPlaySvg from 'bootstrap-icons/icons/file-earmark-play.svg?raw';
import fileEarmarkMusicSvg from 'bootstrap-icons/icons/file-earmark-music.svg?raw';
import fileEarmarkPdfSvg from 'bootstrap-icons/icons/file-earmark-pdf.svg?raw';
import fileEarmarkWordSvg from 'bootstrap-icons/icons/file-earmark-word.svg?raw';
import fileEarmarkSpreadsheetSvg from 'bootstrap-icons/icons/file-earmark-spreadsheet.svg?raw';
import fileEarmarkZipSvg from 'bootstrap-icons/icons/file-earmark-zip.svg?raw';
import fileEarmarkCodeSvg from 'bootstrap-icons/icons/file-earmark-code.svg?raw';
import fileEarmarkTextSvg from 'bootstrap-icons/icons/file-earmark-text.svg?raw';
import fileEarmarkSvg from 'bootstrap-icons/icons/file-earmark.svg?raw';
import chatSvg from 'bootstrap-icons/icons/chat.svg?raw';

export interface FileIcon {
  svg: TemplateResult;
  colorClass: string;
}

/**
 * Takes a raw SVG string from bootstrap-icons and returns a Lit TemplateResult
 * with the specified dimensions. Safe because SVGs come from the trusted
 * bootstrap-icons npm package, not user input.
 */
function renderIcon(rawSvg: string, size: number): TemplateResult {
  const resized = rawSvg
    .replace(/width="16"/, `width="${size}"`)
    .replace(/height="16"/, `height="${size}"`);
  return html`${unsafeHTML(resized)}`;
}

/**
 * Returns an appropriate icon and color for a file based on its extension.
 * Uses SVGs imported from the bootstrap-icons package.
 */
export function getFileTypeIcon(filename: string, size: number = 24): FileIcon {
  const ext = filename.toLowerCase().split('.').pop() || '';

  // Images
  if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp', 'ico'].includes(ext)) {
    return {
      svg: renderIcon(fileEarmarkImageSvg, size),
      colorClass: 'text-purple-400',
    };
  }

  // Videos
  if (['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv'].includes(ext)) {
    return {
      svg: renderIcon(fileEarmarkPlaySvg, size),
      colorClass: 'text-pink-400',
    };
  }

  // Audio
  if (['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'wma'].includes(ext)) {
    return {
      svg: renderIcon(fileEarmarkMusicSvg, size),
      colorClass: 'text-teal-400',
    };
  }

  // PDFs
  if (ext === 'pdf') {
    return {
      svg: renderIcon(fileEarmarkPdfSvg, size),
      colorClass: 'text-red-400',
    };
  }

  // Documents (Word)
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) {
    return {
      svg: renderIcon(fileEarmarkWordSvg, size),
      colorClass: 'text-blue-400',
    };
  }

  // Spreadsheets
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) {
    return {
      svg: renderIcon(fileEarmarkSpreadsheetSvg, size),
      colorClass: 'text-green-400',
    };
  }

  // Archives
  if (['zip', 'tar', 'gz', 'rar', '7z', 'bz2', 'xz'].includes(ext)) {
    return {
      svg: renderIcon(fileEarmarkZipSvg, size),
      colorClass: 'text-amber-400',
    };
  }

  // Code files and HTML/CSS/Web share the same icon (deduplicated)
  if (['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'cs', 'go', 'rs', 'php', 'rb', 'swift', 'kt'].includes(ext)) {
    return {
      svg: renderIcon(fileEarmarkCodeSvg, size),
      colorClass: 'text-cyan-400',
    };
  }

  if (['html', 'css', 'scss', 'sass', 'less'].includes(ext)) {
    return {
      svg: renderIcon(fileEarmarkCodeSvg, size),
      colorClass: 'text-orange-400',
    };
  }

  // Text files
  if (['txt', 'md', 'log', 'json', 'xml', 'yml', 'yaml', 'toml', 'ini', 'conf'].includes(ext)) {
    return {
      svg: renderIcon(fileEarmarkTextSvg, size),
      colorClass: 'text-slate-400',
    };
  }

  // Default: generic file icon
  return {
    svg: renderIcon(fileEarmarkSvg, size),
    colorClass: 'text-slate-400',
  };
}

/**
 * Returns an icon for text content type items.
 */
export function getTextItemIcon(size: number = 24): FileIcon {
  return {
    svg: renderIcon(chatSvg, size),
    colorClass: 'text-sky-400',
  };
}
