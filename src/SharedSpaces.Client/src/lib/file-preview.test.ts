import { describe, it, expect } from 'vitest';
import { getPreviewType, type PreviewType } from '../features/space-view/file-preview';

describe('getPreviewType', () => {
  describe('image extensions', () => {
    it.each([
      ['photo.jpg', 'image'],
      ['photo.jpeg', 'image'],
      ['screenshot.png', 'image'],
      ['animation.gif', 'image'],
      ['modern.webp', 'image'],
      ['vector.svg', 'image'],
      ['bitmap.bmp', 'image'],
      ['favicon.ico', 'image'],
    ] as [string, PreviewType][])(
      '%s → %s',
      (filename, expected) => {
        expect(getPreviewType(filename)).toBe(expected);
      },
    );
  });

  describe('video extensions', () => {
    it.each([
      ['movie.mp4', 'video'],
      ['clip.webm', 'video'],
    ] as [string, PreviewType][])(
      '%s → %s',
      (filename, expected) => {
        expect(getPreviewType(filename)).toBe(expected);
      },
    );

    it('does not treat non-browser-native video formats as previewable', () => {
      expect(getPreviewType('clip.avi')).toBe('none');
      expect(getPreviewType('clip.mkv')).toBe('none');
      expect(getPreviewType('clip.mov')).toBe('none');
      expect(getPreviewType('clip.wmv')).toBe('none');
      expect(getPreviewType('clip.flv')).toBe('none');
    });
  });

  describe('audio extensions', () => {
    it.each([
      ['song.mp3', 'audio'],
      ['sound.wav', 'audio'],
      ['audio.ogg', 'audio'],
      ['track.m4a', 'audio'],
      ['lossless.flac', 'audio'],
      ['encoded.aac', 'audio'],
    ] as [string, PreviewType][])(
      '%s → %s',
      (filename, expected) => {
        expect(getPreviewType(filename)).toBe(expected);
      },
    );
  });

  describe('PDF', () => {
    it('returns pdf for .pdf extension', () => {
      expect(getPreviewType('report.pdf')).toBe('pdf');
    });
  });

  describe('text/code extensions', () => {
    describe('plain text', () => {
      it.each([
        ['notes.txt', 'text'],
        ['error.log', 'text'],
        ['data.csv', 'text'],
        ['settings.ini', 'text'],
        ['server.conf', 'text'],
      ] as [string, PreviewType][])(
        '%s → %s',
        (filename, expected) => {
          expect(getPreviewType(filename)).toBe(expected);
        },
      );
    });

    describe('structured data', () => {
      it.each([
        ['config.json', 'text'],
        ['data.xml', 'text'],
        ['config.yaml', 'text'],
        ['config.yml', 'text'],
        ['settings.toml', 'text'],
      ] as [string, PreviewType][])(
        '%s → %s',
        (filename, expected) => {
          expect(getPreviewType(filename)).toBe(expected);
        },
      );
    });

    describe('markdown', () => {
      it('returns text for .md files', () => {
        expect(getPreviewType('README.md')).toBe('text');
      });
    });

    describe('code files', () => {
      it.each([
        ['app.js', 'text'],
        ['module.ts', 'text'],
        ['component.jsx', 'text'],
        ['component.tsx', 'text'],
        ['script.py', 'text'],
        ['Main.java', 'text'],
        ['main.c', 'text'],
        ['main.cpp', 'text'],
        ['Program.cs', 'text'],
        ['main.go', 'text'],
        ['main.rs', 'text'],
        ['index.php', 'text'],
        ['app.rb', 'text'],
        ['app.swift', 'text'],
        ['Main.kt', 'text'],
        ['deploy.sh', 'text'],
        ['page.html', 'text'],
        ['styles.css', 'text'],
        ['styles.scss', 'text'],
        ['query.sql', 'text'],
      ] as [string, PreviewType][])(
        '%s → %s',
        (filename, expected) => {
          expect(getPreviewType(filename)).toBe(expected);
        },
      );
    });
  });

  describe('non-previewable files', () => {
    it.each([
      ['archive.zip', 'none'],
      ['document.docx', 'none'],
      ['spreadsheet.xlsx', 'none'],
      ['backup.tar', 'none'],
      ['compressed.gz', 'none'],
      ['archive.rar', 'none'],
      ['archive.7z', 'none'],
      ['presentation.pptx', 'none'],
      ['binary.exe', 'none'],
      ['library.dll', 'none'],
      ['database.db', 'none'],
      ['disk.iso', 'none'],
    ] as [string, PreviewType][])(
      '%s → %s',
      (filename, expected) => {
        expect(getPreviewType(filename)).toBe(expected);
      },
    );
  });

  describe('case insensitivity', () => {
    it('treats .JPG the same as .jpg', () => {
      expect(getPreviewType('PHOTO.JPG')).toBe('image');
    });

    it('treats .Pdf the same as .pdf', () => {
      expect(getPreviewType('Report.Pdf')).toBe('pdf');
    });

    it('treats .MP4 the same as .mp4', () => {
      expect(getPreviewType('VIDEO.MP4')).toBe('video');
    });

    it('treats .TXT the same as .txt', () => {
      expect(getPreviewType('NOTES.TXT')).toBe('text');
    });

    it('treats .MP3 the same as .mp3', () => {
      expect(getPreviewType('SONG.MP3')).toBe('audio');
    });

    it('mixed case extension works', () => {
      expect(getPreviewType('photo.JpEg')).toBe('image');
    });
  });

  describe('edge cases', () => {
    it('returns none for empty string', () => {
      expect(getPreviewType('')).toBe('none');
    });

    it('returns none for filename with no extension', () => {
      expect(getPreviewType('README')).toBe('none');
      expect(getPreviewType('Makefile')).toBe('none');
    });

    it('uses last extension for double extensions (.tar.gz → gz → none)', () => {
      expect(getPreviewType('archive.tar.gz')).toBe('none');
    });

    it('uses last extension for double extensions (.data.json → json → text)', () => {
      expect(getPreviewType('config.data.json')).toBe('text');
    });

    it('handles dots in directory-like filename', () => {
      expect(getPreviewType('my.file.name.pdf')).toBe('pdf');
    });

    it('returns none for dot-only filename', () => {
      expect(getPreviewType('.')).toBe('none');
    });

    it('handles hidden files (dot-prefixed) with extension', () => {
      expect(getPreviewType('.gitignore')).toBe('none');
    });

    it('handles hidden file with known extension', () => {
      expect(getPreviewType('.config.json')).toBe('text');
    });

    it('returns none for filename ending with dot', () => {
      expect(getPreviewType('file.')).toBe('none');
    });
  });

  describe('boundary between previewable and non-previewable', () => {
    it('csv is previewable as text, xlsx is not', () => {
      expect(getPreviewType('data.csv')).toBe('text');
      expect(getPreviewType('data.xlsx')).toBe('none');
    });

    it('mp4 is previewable, avi is not', () => {
      expect(getPreviewType('video.mp4')).toBe('video');
      expect(getPreviewType('video.avi')).toBe('none');
    });

    it('html is previewable as text (not rendered)', () => {
      expect(getPreviewType('page.html')).toBe('text');
    });

    it('every preview type except none is a valid preview category', () => {
      const allTypes = new Set<PreviewType>();
      allTypes.add(getPreviewType('photo.jpg'));   // image
      allTypes.add(getPreviewType('clip.mp4'));     // video
      allTypes.add(getPreviewType('song.mp3'));     // audio
      allTypes.add(getPreviewType('doc.pdf'));      // pdf
      allTypes.add(getPreviewType('notes.txt'));    // text
      allTypes.add(getPreviewType('archive.zip')); // none

      expect(allTypes).toEqual(
        new Set(['image', 'video', 'audio', 'pdf', 'text', 'none']),
      );
    });
  });
});
