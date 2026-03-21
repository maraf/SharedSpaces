import { describe, it, expect } from 'vitest';
import { getFileTypeIcon, getTextItemIcon } from './file-icons';

describe('getFileTypeIcon', () => {
  describe('image files', () => {
    it('returns purple-400 color for .jpg files', () => {
      const result = getFileTypeIcon('photo.jpg');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(result.colorClass).toBe('text-purple-400');
    });

    it('returns image icon for .png files', () => {
      const result = getFileTypeIcon('screenshot.png');
      expect(result.svg).toBeTruthy();
      expect(result.colorClass).toBe('text-purple-400');
    });

    it('returns image icon for .gif files', () => {
      const result = getFileTypeIcon('animation.gif');
      expect(result.svg).toBeTruthy();
      expect(result.colorClass).toBe('text-purple-400');
    });

    it('returns image icon for .svg files', () => {
      const result = getFileTypeIcon('vector.svg');
      expect(result.svg).toBeTruthy();
      expect(result.colorClass).toBe('text-purple-400');
    });

    it('returns image icon for .webp files', () => {
      const result = getFileTypeIcon('modern.webp');
      expect(result.svg).toBeTruthy();
      expect(result.colorClass).toBe('text-purple-400');
    });
  });

  describe('document files', () => {
    it('returns red-400 color for .pdf files', () => {
      const result = getFileTypeIcon('report.pdf');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(result.colorClass).toBe('text-red-400');
    });

    it('returns blue-400 color for .doc files', () => {
      const result = getFileTypeIcon('legacy.doc');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(result.colorClass).toBe('text-blue-400');
    });

    it('returns blue-400 color for .docx files', () => {
      const result = getFileTypeIcon('modern.docx');
      expect(result.svg).toBeTruthy();
      expect(result.colorClass).toBe('text-blue-400');
    });
  });

  describe('spreadsheet files', () => {
    it('returns green-400 color for .xls files', () => {
      const result = getFileTypeIcon('data.xls');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(result.colorClass).toBe('text-green-400');
    });

    it('returns spreadsheet icon for .xlsx files', () => {
      const result = getFileTypeIcon('data.xlsx');
      expect(result.svg).toBeTruthy();
      expect(result.colorClass).toBe('text-green-400');
    });

    it('returns spreadsheet icon for .csv files', () => {
      const result = getFileTypeIcon('export.csv');
      expect(result.svg).toBeTruthy();
      expect(result.colorClass).toBe('text-green-400');
    });
  });

  describe('code files', () => {
    it('returns cyan-400 color for .js files', () => {
      const result = getFileTypeIcon('script.js');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(result.colorClass).toBe('text-cyan-400');
    });

    it('returns code icon for .ts files', () => {
      const result = getFileTypeIcon('module.ts');
      expect(result.svg).toBeTruthy();
      expect(result.colorClass).toBe('text-cyan-400');
    });

    it('returns code icon for .py files', () => {
      const result = getFileTypeIcon('script.py');
      expect(result.svg).toBeTruthy();
      expect(result.colorClass).toBe('text-cyan-400');
    });
  });

  describe('HTML/CSS files', () => {
    it('returns orange-400 color for .html files', () => {
      const result = getFileTypeIcon('page.html');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(result.colorClass).toBe('text-orange-400');
    });

    it('returns orange-400 color for .css files', () => {
      const result = getFileTypeIcon('styles.css');
      expect(result.svg).toBeTruthy();
      expect(result.colorClass).toBe('text-orange-400');
    });
  });

  describe('archive files', () => {
    it('returns amber-400 color for .zip files', () => {
      const result = getFileTypeIcon('package.zip');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(result.colorClass).toBe('text-amber-400');
    });

    it('returns archive icon for .tar files', () => {
      const result = getFileTypeIcon('backup.tar');
      expect(result.svg).toBeTruthy();
      expect(result.colorClass).toBe('text-amber-400');
    });

    it('returns archive icon for .gz files', () => {
      const result = getFileTypeIcon('compressed.gz');
      expect(result.svg).toBeTruthy();
      expect(result.colorClass).toBe('text-amber-400');
    });

    it('returns archive icon for .rar files', () => {
      const result = getFileTypeIcon('archive.rar');
      expect(result.svg).toBeTruthy();
      expect(result.colorClass).toBe('text-amber-400');
    });
  });

  describe('video files', () => {
    it('returns pink-400 color for .mp4 files', () => {
      const result = getFileTypeIcon('movie.mp4');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(result.colorClass).toBe('text-pink-400');
    });

    it('returns video icon for .mov files', () => {
      const result = getFileTypeIcon('clip.mov');
      expect(result.svg).toBeTruthy();
      expect(result.colorClass).toBe('text-pink-400');
    });

    it('returns video icon for .avi files', () => {
      const result = getFileTypeIcon('video.avi');
      expect(result.svg).toBeTruthy();
      expect(result.colorClass).toBe('text-pink-400');
    });
  });

  describe('audio files', () => {
    it('returns teal-400 color for .mp3 files', () => {
      const result = getFileTypeIcon('song.mp3');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(result.colorClass).toBe('text-teal-400');
    });

    it('returns audio icon for .wav files', () => {
      const result = getFileTypeIcon('sound.wav');
      expect(result.svg).toBeTruthy();
      expect(result.colorClass).toBe('text-teal-400');
    });

    it('returns audio icon for .ogg files', () => {
      const result = getFileTypeIcon('audio.ogg');
      expect(result.svg).toBeTruthy();
      expect(result.colorClass).toBe('text-teal-400');
    });
  });

  describe('text files', () => {
    it('returns slate-400 color for .txt files', () => {
      const result = getFileTypeIcon('notes.txt');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(result.colorClass).toBe('text-slate-400');
    });

    it('returns text icon for .md files', () => {
      const result = getFileTypeIcon('README.md');
      expect(result.svg).toBeTruthy();
      expect(result.colorClass).toBe('text-slate-400');
    });

    it('returns text icon for .log files', () => {
      const result = getFileTypeIcon('error.log');
      expect(result.svg).toBeTruthy();
      expect(result.colorClass).toBe('text-slate-400');
    });
  });

  describe('edge cases', () => {
    it('returns slate-400 default color for unknown extension', () => {
      const result = getFileTypeIcon('file.xyz');
      expect(result.svg).toBeTruthy();
      expect(typeof result.svg).toBe('object');
      expect(result.colorClass).toBe('text-slate-400');
    });

    it('handles case insensitivity - uppercase extension', () => {
      const upperResult = getFileTypeIcon('PHOTO.JPG');
      const lowerResult = getFileTypeIcon('photo.jpg');
      expect(upperResult.colorClass).toBe('text-purple-400');
      expect(lowerResult.colorClass).toBe('text-purple-400');
    });

    it('handles files with multiple dots', () => {
      const result = getFileTypeIcon('my.file.name.pdf');
      expect(result.svg).toBeTruthy();
      expect(result.colorClass).toBe('text-red-400');
    });

    it('returns default icon for empty string', () => {
      const result = getFileTypeIcon('');
      expect(result.svg).toBeTruthy();
      expect(result.colorClass).toBe('text-slate-400');
    });

    it('returns default icon for filename with no extension', () => {
      const result = getFileTypeIcon('README');
      expect(result.svg).toBeTruthy();
      expect(result.colorClass).toBe('text-slate-400');
    });
  });

  describe('cross-category distinctness', () => {
    it('image and code categories return different colors', () => {
      const image = getFileTypeIcon('photo.jpg');
      const code = getFileTypeIcon('script.js');
      expect(image.colorClass).not.toBe(code.colorClass);
    });

    it('video and audio categories return different colors', () => {
      const video = getFileTypeIcon('movie.mp4');
      const audio = getFileTypeIcon('song.mp3');
      expect(video.colorClass).not.toBe(audio.colorClass);
    });

    it('PDF and Word document categories return different colors', () => {
      const pdf = getFileTypeIcon('report.pdf');
      const doc = getFileTypeIcon('essay.docx');
      expect(pdf.colorClass).not.toBe(doc.colorClass);
    });

    it('spreadsheet and archive categories return different colors', () => {
      const spreadsheet = getFileTypeIcon('data.xlsx');
      const archive = getFileTypeIcon('package.zip');
      expect(spreadsheet.colorClass).not.toBe(archive.colorClass);
    });

    it('HTML/CSS and code categories return different colors', () => {
      const htmlCss = getFileTypeIcon('page.html');
      const code = getFileTypeIcon('script.ts');
      expect(htmlCss.colorClass).not.toBe(code.colorClass);
    });

    it('all primary categories have unique colors', () => {
      const colors = [
        getFileTypeIcon('photo.jpg').colorClass,   // image: purple
        getFileTypeIcon('movie.mp4').colorClass,    // video: pink
        getFileTypeIcon('song.mp3').colorClass,     // audio: teal
        getFileTypeIcon('report.pdf').colorClass,   // pdf: red
        getFileTypeIcon('essay.docx').colorClass,   // doc: blue
        getFileTypeIcon('data.xlsx').colorClass,     // spreadsheet: green
        getFileTypeIcon('package.zip').colorClass,  // archive: amber
        getFileTypeIcon('script.js').colorClass,    // code: cyan
        getFileTypeIcon('page.html').colorClass,    // html/css: orange
      ];
      const unique = new Set(colors);
      expect(unique.size).toBe(colors.length);
    });
  });
});

describe('getTextItemIcon', () => {
  it('returns sky-400 color for text item icon', () => {
    const result = getTextItemIcon();
    expect(result.svg).toBeTruthy();
    expect(typeof result.svg).toBe('object');
    expect(result.colorClass).toBe('text-sky-400');
  });

  it('colorClass is a valid Tailwind text color class', () => {
    const result = getTextItemIcon();
    expect(result.colorClass).toMatch(/^text-/);
    expect(result.colorClass.length).toBeGreaterThan(0);
  });
});
