import { describe, it, expect } from 'vitest';
import { getFileTypeIcon, getTextItemIcon } from './file-icons';

describe('getFileTypeIcon', () => {
  describe('image files', () => {
    it('returns image icon for .jpg files', () => {
      const result = getFileTypeIcon('photo.jpg');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(typeof result.colorClass).toBe('string');
      expect(result.colorClass).not.toBe('');
    });

    it('returns image icon for .png files', () => {
      const result = getFileTypeIcon('screenshot.png');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(typeof result.colorClass).toBe('string');
    });

    it('returns image icon for .gif files', () => {
      const result = getFileTypeIcon('animation.gif');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(typeof result.colorClass).toBe('string');
    });

    it('returns image icon for .svg files', () => {
      const result = getFileTypeIcon('vector.svg');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(typeof result.colorClass).toBe('string');
    });

    it('returns image icon for .webp files', () => {
      const result = getFileTypeIcon('modern.webp');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(typeof result.colorClass).toBe('string');
    });
  });

  describe('document files', () => {
    it('returns document icon for .pdf files', () => {
      const result = getFileTypeIcon('report.pdf');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(typeof result.colorClass).toBe('string');
    });

    it('returns document icon for .doc files', () => {
      const result = getFileTypeIcon('legacy.doc');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(typeof result.colorClass).toBe('string');
    });

    it('returns document icon for .docx files', () => {
      const result = getFileTypeIcon('modern.docx');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(typeof result.colorClass).toBe('string');
    });
  });

  describe('spreadsheet files', () => {
    it('returns spreadsheet icon for .xls files', () => {
      const result = getFileTypeIcon('data.xls');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(typeof result.colorClass).toBe('string');
    });

    it('returns spreadsheet icon for .xlsx files', () => {
      const result = getFileTypeIcon('data.xlsx');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(typeof result.colorClass).toBe('string');
    });

    it('returns spreadsheet icon for .csv files', () => {
      const result = getFileTypeIcon('export.csv');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(typeof result.colorClass).toBe('string');
    });
  });

  describe('code files', () => {
    it('returns code icon for .js files', () => {
      const result = getFileTypeIcon('script.js');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(typeof result.colorClass).toBe('string');
    });

    it('returns code icon for .ts files', () => {
      const result = getFileTypeIcon('module.ts');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(typeof result.colorClass).toBe('string');
    });

    it('returns code icon for .py files', () => {
      const result = getFileTypeIcon('script.py');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(typeof result.colorClass).toBe('string');
    });

    it('returns code icon for .html files', () => {
      const result = getFileTypeIcon('page.html');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(typeof result.colorClass).toBe('string');
    });

    it('returns code icon for .css files', () => {
      const result = getFileTypeIcon('styles.css');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(typeof result.colorClass).toBe('string');
    });
  });

  describe('archive files', () => {
    it('returns archive icon for .zip files', () => {
      const result = getFileTypeIcon('package.zip');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(typeof result.colorClass).toBe('string');
    });

    it('returns archive icon for .tar files', () => {
      const result = getFileTypeIcon('backup.tar');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(typeof result.colorClass).toBe('string');
    });

    it('returns archive icon for .gz files', () => {
      const result = getFileTypeIcon('compressed.gz');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(typeof result.colorClass).toBe('string');
    });

    it('returns archive icon for .rar files', () => {
      const result = getFileTypeIcon('archive.rar');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(typeof result.colorClass).toBe('string');
    });
  });

  describe('video files', () => {
    it('returns video icon for .mp4 files', () => {
      const result = getFileTypeIcon('movie.mp4');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(typeof result.colorClass).toBe('string');
    });

    it('returns video icon for .mov files', () => {
      const result = getFileTypeIcon('clip.mov');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(typeof result.colorClass).toBe('string');
    });

    it('returns video icon for .avi files', () => {
      const result = getFileTypeIcon('video.avi');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(typeof result.colorClass).toBe('string');
    });
  });

  describe('audio files', () => {
    it('returns audio icon for .mp3 files', () => {
      const result = getFileTypeIcon('song.mp3');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(typeof result.colorClass).toBe('string');
    });

    it('returns audio icon for .wav files', () => {
      const result = getFileTypeIcon('sound.wav');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(typeof result.colorClass).toBe('string');
    });

    it('returns audio icon for .ogg files', () => {
      const result = getFileTypeIcon('audio.ogg');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(typeof result.colorClass).toBe('string');
    });
  });

  describe('text files', () => {
    it('returns text icon for .txt files', () => {
      const result = getFileTypeIcon('notes.txt');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(typeof result.colorClass).toBe('string');
    });

    it('returns text icon for .md files', () => {
      const result = getFileTypeIcon('README.md');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(typeof result.colorClass).toBe('string');
    });

    it('returns text icon for .log files', () => {
      const result = getFileTypeIcon('error.log');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(typeof result.colorClass).toBe('string');
    });
  });

  describe('edge cases', () => {
    it('returns default icon for unknown extension', () => {
      const result = getFileTypeIcon('file.xyz');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(typeof result.colorClass).toBe('string');
    });

    it('handles case insensitivity - uppercase extension', () => {
      const upperResult = getFileTypeIcon('PHOTO.JPG');
      const lowerResult = getFileTypeIcon('photo.jpg');
      expect(upperResult.svg).toBeTruthy();
      expect(lowerResult.svg).toBeTruthy();
      expect(typeof upperResult.colorClass).toBe('string');
      expect(typeof lowerResult.colorClass).toBe('string');
    });

    it('handles files with multiple dots', () => {
      const result = getFileTypeIcon('my.file.name.pdf');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(typeof result.colorClass).toBe('string');
    });

    it('returns default icon for empty string', () => {
      const result = getFileTypeIcon('');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(typeof result.colorClass).toBe('string');
    });

    it('returns default icon for filename with no extension', () => {
      const result = getFileTypeIcon('README');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(typeof result.colorClass).toBe('string');
    });
  });
});

describe('getTextItemIcon', () => {
  it('returns a valid icon result with svg and colorClass', () => {
    const result = getTextItemIcon();
    expect(result.svg).toBeTruthy();
    expect(typeof result.svg).toBe('object');
    expect(typeof result.colorClass).toBe('string');
    expect(result.colorClass).not.toBe('');
  });

  it('colorClass is a valid non-empty string', () => {
    const result = getTextItemIcon();
    expect(typeof result.colorClass).toBe('string');
    expect(result.colorClass.length).toBeGreaterThan(0);
    // Verify it looks like a Tailwind color class (starts with text- or similar)
    expect(result.colorClass).toMatch(/^(text-|bg-|border-)/);
  });
});
