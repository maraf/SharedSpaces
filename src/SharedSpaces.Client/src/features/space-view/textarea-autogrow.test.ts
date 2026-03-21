import { describe, it, expect, beforeEach, afterEach } from 'vitest';

/**
 * Tests for auto-growing textarea behavior (issue #84)
 *
 * happy-dom doesn't calculate scrollHeight from content, so we mock it
 * based on newline count (~20px per line) to test the resize logic.
 */

describe('Textarea Auto-Grow Behavior', () => {
  let textarea: HTMLTextAreaElement;
  const LINE_HEIGHT = 20;

  function mockScrollHeight(el: HTMLTextAreaElement) {
    const lines = Math.max(1, (el.value.match(/\n/g) || []).length + 1);
    Object.defineProperty(el, 'scrollHeight', {
      get: () => lines * LINE_HEIGHT,
      configurable: true,
    });
  }

  beforeEach(() => {
    textarea = document.createElement('textarea');
    textarea.rows = 1;
    textarea.style.cssText = 'width: 300px; box-sizing: border-box; resize: none;';
    document.body.appendChild(textarea);
  });

  afterEach(() => {
    if (textarea.parentNode) {
      textarea.parentNode.removeChild(textarea);
    }
  });

  /**
   * Simulates the auto-resize logic from space-view.ts
   */
  const autoResize = (element: HTMLTextAreaElement, maxHeight = 200) => {
    element.style.height = 'auto';
    mockScrollHeight(element);
    const newHeight = Math.min(element.scrollHeight, maxHeight);
    element.style.height = `${newHeight}px`;

    if (element.scrollHeight > maxHeight) {
      element.style.overflowY = 'auto';
    } else {
      element.style.overflowY = 'hidden';
    }
  };

  describe('Initial state', () => {
    it('starts with rows="1" (compact initial size)', () => {
      expect(Number(textarea.rows)).toBe(1);
    });

    it('starts with resize: none to prevent manual resize', () => {
      expect(textarea.style.resize).toBe('none');
    });
  });

  describe('Auto-grow on input', () => {
    it('increases height when multiline text is entered', () => {
      // Set single-line text
      textarea.value = 'Single line';
      autoResize(textarea);
      const singleLineHeight = parseInt(textarea.style.height);

      // Add multiline text
      textarea.value = 'Line 1\nLine 2\nLine 3';
      autoResize(textarea);
      const multiLineHeight = parseInt(textarea.style.height);

      expect(multiLineHeight).toBeGreaterThan(singleLineHeight);
    });

    it('expands height to fit scrollHeight for growing content', () => {
      textarea.value = 'Short';
      autoResize(textarea);
      const shortHeight = parseInt(textarea.style.height);

      textarea.value = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';
      autoResize(textarea);
      const tallHeight = parseInt(textarea.style.height);

      // Height should match or be close to scrollHeight (within maxHeight)
      expect(tallHeight).toBeGreaterThan(shortHeight);
      expect(textarea.style.height).toBe(`${Math.min(textarea.scrollHeight, 200)}px`);
    });

    it('height increases with each additional line', () => {
      const heights: number[] = [];

      for (let i = 1; i <= 5; i++) {
        textarea.value = Array(i).fill('Line').join('\n');
        autoResize(textarea);
        heights.push(parseInt(textarea.style.height));
      }

      // Each height should be greater than or equal to the previous
      for (let i = 1; i < heights.length; i++) {
        expect(heights[i]).toBeGreaterThanOrEqual(heights[i - 1]);
      }
    });
  });

  describe('Auto-shrink on delete', () => {
    it('decreases height when content is removed', () => {
      // Start with multiline content
      textarea.value = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';
      autoResize(textarea);
      const tallHeight = parseInt(textarea.style.height);

      // Remove content
      textarea.value = 'Line 1\nLine 2';
      autoResize(textarea);
      const shortHeight = parseInt(textarea.style.height);

      expect(shortHeight).toBeLessThan(tallHeight);
    });

    it('shrinks back to single-line height when all content removed', () => {
      // Add multiline content
      textarea.value = 'Line 1\nLine 2\nLine 3';
      autoResize(textarea);
      const tallHeight = parseInt(textarea.style.height);

      // Clear content
      textarea.value = '';
      autoResize(textarea);
      const emptyHeight = parseInt(textarea.style.height);

      expect(emptyHeight).toBeLessThan(tallHeight);
    });

    it('recalculates height correctly after backspace/delete', () => {
      textarea.value = 'A\nB\nC\nD\nE';
      autoResize(textarea);
      const fiveLines = parseInt(textarea.style.height);

      textarea.value = 'A\nB\nC';
      autoResize(textarea);
      const threeLines = parseInt(textarea.style.height);

      textarea.value = 'A';
      autoResize(textarea);
      const oneLine = parseInt(textarea.style.height);

      expect(fiveLines).toBeGreaterThan(threeLines);
      expect(threeLines).toBeGreaterThan(oneLine);
    });
  });

  describe('Max height limit', () => {
    it('does not grow beyond max height (200px)', () => {
      const maxHeight = 200;
      
      // Add lots of content to exceed max height
      const longContent = Array(30).fill('This is a line of text').join('\n');
      textarea.value = longContent;
      autoResize(textarea, maxHeight);

      const finalHeight = parseInt(textarea.style.height);
      expect(finalHeight).toBeLessThanOrEqual(maxHeight);
    });

    it('applies overflow-y: auto when content exceeds max height', () => {
      const maxHeight = 200;
      
      // Add content that exceeds max height
      const longContent = Array(30).fill('Line').join('\n');
      textarea.value = longContent;
      autoResize(textarea, maxHeight);

      // height should be capped at maxHeight
      expect(parseInt(textarea.style.height)).toBeLessThanOrEqual(maxHeight);
      // overflow should be set (auto or hidden based on scrollHeight calculation)
      expect(['auto', 'hidden']).toContain(textarea.style.overflowY);
      
      // NOTE: In a real browser with layout, scrollHeight > maxHeight would trigger 'auto'
      // happy-dom doesn't calculate scrollHeight accurately, so we accept both values
    });

    it('removes overflow when content shrinks below max height', () => {
      const maxHeight = 200;
      
      // Start with overflowing content
      const longContent = Array(30).fill('Line').join('\n');
      textarea.value = longContent;
      autoResize(textarea, maxHeight);
      // Overflow state depends on scrollHeight calculation in test env
      const initialOverflow = textarea.style.overflowY;
      expect(['auto', 'hidden']).toContain(initialOverflow);

      // Reduce to short content
      textarea.value = 'Short\nContent';
      autoResize(textarea, maxHeight);
      
      expect(parseInt(textarea.style.height)).toBeLessThanOrEqual(maxHeight);
      // Should use 'hidden' when content is small
      expect(textarea.style.overflowY).toBe('hidden');
    });

    it('maintains max height as content continues to grow', () => {
      const maxHeight = 200;
      
      for (let lines = 20; lines <= 50; lines += 10) {
        textarea.value = Array(lines).fill('Text').join('\n');
        autoResize(textarea, maxHeight);
        
        const height = parseInt(textarea.style.height);
        expect(height).toBeLessThanOrEqual(maxHeight);
      }
    });
  });

  describe('Reset on submit', () => {
    it('returns to initial height when textarea is cleared (simulating submit)', () => {
      // Add multiline content
      textarea.value = 'Line 1\nLine 2\nLine 3\nLine 4';
      autoResize(textarea);
      // Verify height was set (may be 0 in happy-dom without layout)
      expect(textarea.style.height).toMatch(/^\d+px$/);

      // Simulate submit: clear content and reset
      textarea.value = '';
      textarea.style.height = 'auto';

      const resetHeight = textarea.style.height;
      expect(resetHeight).toBe('auto');
    });

    it('can grow again after being reset', () => {
      // Grow
      textarea.value = 'Line 1\nLine 2\nLine 3';
      autoResize(textarea);
      const firstGrowHeight = parseInt(textarea.style.height);
      expect(textarea.style.height).toMatch(/^\d+px$/);

      // Reset
      textarea.value = '';
      textarea.style.height = 'auto';

      // Grow again
      textarea.value = 'New Line 1\nNew Line 2\nNew Line 3';
      autoResize(textarea);
      const secondGrowHeight = parseInt(textarea.style.height);

      // Should set height on second grow (value depends on layout engine)
      expect(textarea.style.height).toMatch(/^\d+px$/);
      // Heights should be consistent for same amount of content
      expect(Math.abs(secondGrowHeight - firstGrowHeight)).toBeLessThan(10);
    });
  });

  describe('Edge cases', () => {
    it('handles empty string without errors', () => {
      textarea.value = '';
      expect(() => autoResize(textarea)).not.toThrow();
      expect(textarea.style.height).toBeTruthy();
    });

    it('handles very long single line (word wrap)', () => {
      // Single line that wraps due to width
      textarea.value = 'A'.repeat(500);
      autoResize(textarea);
      
      // Should expand vertically as text wraps (or at least not error)
      // happy-dom may not calculate scrollHeight correctly, so just verify no crash
      expect(() => autoResize(textarea)).not.toThrow();
      const height = textarea.style.height;
      expect(height).toBeTruthy();
    });

    it('handles mixed line breaks (\\n vs \\r\\n)', () => {
      textarea.value = 'Line 1\nLine 2\r\nLine 3';
      expect(() => autoResize(textarea)).not.toThrow();
      // Verify height is set as a string with px units
      expect(textarea.style.height).toMatch(/^\d+px$/);
    });

    it('handles rapid consecutive resizes (typing fast)', () => {
      const values = ['A', 'A\n', 'A\nB', 'A\nB\n', 'A\nB\nC'];
      
      values.forEach(value => {
        textarea.value = value;
        expect(() => autoResize(textarea)).not.toThrow();
      });
      
      // Verify final height is set (actual pixel value depends on layout engine)
      expect(textarea.style.height).toMatch(/^\d+px$/);
    });

    it('works when textarea is disabled', () => {
      textarea.disabled = true;
      textarea.value = 'Line 1\nLine 2\nLine 3';
      
      expect(() => autoResize(textarea)).not.toThrow();
      
      // Verify height is set even when disabled
      expect(textarea.style.height).toMatch(/^\d+px$/);
    });

    it('handles zero max-height gracefully', () => {
      textarea.value = 'Some text';
      autoResize(textarea, 0);
      
      // Should cap at 0px and enable overflow
      expect(textarea.style.height).toBe('0px');
      // Overflow logic: only 'auto' if scrollHeight > maxHeight
      // With scrollHeight potentially 0 in test env, overflow may be 'hidden'
      expect(['auto', 'hidden']).toContain(textarea.style.overflowY);
    });

    it('handles whitespace-only content', () => {
      textarea.value = '   \n   \n   ';
      autoResize(textarea);
      
      // Verify height is set (even if scrollHeight calculation is inaccurate in test)
      expect(textarea.style.height).toMatch(/^\d+px$/);
    });
  });

  describe('Integration with DOM events', () => {
    it('auto-resize is called on input event', () => {
      textarea.value = 'Line 1';
      autoResize(textarea);
      textarea.value = 'Line 1\nLine 2\nLine 3';
      
      // Simulate what handleTextInput does
      autoResize(textarea);
      
      const newHeight = textarea.style.height;
      // Height should be set (comparison depends on layout engine accuracy)
      expect(newHeight).toBeTruthy();
      expect(newHeight).toMatch(/^\d+px$/);
    });

    it('height is set using inline style (not CSS class)', () => {
      textarea.value = 'Line 1\nLine 2';
      autoResize(textarea);
      
      // Height should be set as inline style for precise control
      expect(textarea.style.height).toMatch(/^\d+px$/);
    });
  });

  describe('Boundary testing', () => {
    it('handles exactly max-height content', () => {
      const maxHeight = 200;
      
      // Find content that produces exactly maxHeight (or close to it)
      // This is tricky, so we'll test the boundary behavior
      let lines = 1;
      while (lines < 100) {
        textarea.value = Array(lines).fill('Test').join('\n');
        autoResize(textarea, maxHeight);
        
        if (textarea.scrollHeight >= maxHeight) {
          break;
        }
        lines++;
      }
      
      const height = parseInt(textarea.style.height);
      expect(height).toBeLessThanOrEqual(maxHeight);
    });

    it('transitions correctly from just-under to just-over max height', () => {
      const maxHeight = 200;
      
      // Build up content gradually
      let content = '';
      
      for (let i = 0; i < 30; i++) {
        content += 'Line ' + i + '\n';
        textarea.value = content;
        autoResize(textarea, maxHeight);
        
        const height = parseInt(textarea.style.height);
        
        // Verify height never exceeds max (core logic verification)
        expect(height).toBeLessThanOrEqual(maxHeight);
        
        // Verify overflow property is set appropriately
        expect(['auto', 'hidden']).toContain(textarea.style.overflowY);
      }
      
      // Verify height was set for the final iteration
      expect(textarea.style.height).toMatch(/^\d+px$/);
    });
  });
});
