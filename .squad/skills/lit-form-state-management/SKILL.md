---
name: "lit-form-state-management"
description: "Form state management in Lit components using @state decorator and controlled inputs"
domain: "frontend, lit, forms"
confidence: "high"
source: "earned"
tools:
  - name: "edit"
    description: "Edit Lit component files"
    when: "Implementing form components with local state"
---

## Context

When building forms in Lit components (e.g., login, join, settings), you need to manage:
- Input field values
- Loading states during async operations
- Error messages
- UI mode toggles (e.g., "paste" vs "manual entry")

This skill demonstrates the Lit-idiomatic way to handle form state using the `@state` decorator and controlled input patterns.

## Patterns

### 1. Use `@state` for Internal Form State

```typescript
import { state } from 'lit/decorators.js';

@customElement('my-form')
export class MyForm extends BaseElement {
  // Form field values
  @state() private username = '';
  @state() private password = '';
  
  // UI state
  @state() private isLoading = false;
  @state() private errorMessage = '';
  @state() private mode: 'simple' | 'advanced' = 'simple';
}
```

**Why `@state` not `@property`:**
- `@state` is for internal component state (not exposed as attributes)
- Changes trigger re-render automatically
- No attribute reflection overhead

### 2. Controlled Input Pattern with `.value` Binding

```typescript
private handleUsernameInput = (e: Event) => {
  const input = e.target as HTMLInputElement;
  this.username = input.value;
  this.errorMessage = ''; // Clear errors on input
};

override render() {
  return html`
    <input
      type="text"
      .value=${this.username}
      @input=${this.handleUsernameInput}
      ?disabled=${this.isLoading}
    />
  `;
}
```

**Key details:**
- Use `.value=${...}` (property binding) not `value="${...}"` (attribute binding)
- Property binding keeps input value in sync with state
- Handler updates state, which triggers re-render

### 3. Loading States Disable Inputs

```typescript
@state() private isLoading = false;

private handleSubmit = async () => {
  this.errorMessage = '';
  this.isLoading = true;

  try {
    await this.someAsyncOperation();
    // Navigate or show success
  } catch (error) {
    this.errorMessage = 'Something went wrong';
  } finally {
    this.isLoading = false;
  }
};

override render() {
  return html`
    <input ?disabled=${this.isLoading} />
    <button @click=${this.handleSubmit} ?disabled=${this.isLoading}>
      ${this.isLoading ? 'Submitting...' : 'Submit'}
    </button>
  `;
}
```

### 4. Conditional Error Display

```typescript
override render() {
  return html`
    ${this.errorMessage
      ? html`
          <div class="error-banner">
            ${this.errorMessage}
          </div>
        `
      : ''}
  `;
}
```

**Pattern:** Use ternary with empty string `''` for falsy case, not `null` or `undefined`.

### 5. Mode Toggles for Multi-State Forms

```typescript
@state() private mode: 'paste' | 'manual' = 'paste';

private toggleMode = () => {
  this.mode = this.mode === 'paste' ? 'manual' : 'paste';
  this.errorMessage = ''; // Clear errors on mode change
};

override render() {
  return html`
    <button @click=${this.toggleMode}>
      ${this.mode === 'paste' ? 'Enter manually' : 'Paste invitation'}
    </button>
    
    ${this.mode === 'paste'
      ? html`<input type="text" ... />`
      : html`<input ... /> <input ... />`}
  `;
}
```

### 6. Pre-fill from External Sources on Mount

```typescript
override connectedCallback() {
  super.connectedCallback();
  
  // Pre-fill from URL params
  const urlData = parseFromUrl();
  if (urlData) {
    this.serverUrl = urlData.serverUrl;
    this.spaceId = urlData.spaceId;
  }
  
  // Pre-fill from localStorage
  this.username = localStorage.getItem('username') || '';
}
```

**Why `connectedCallback`:**
- Runs when component is added to DOM
- Safe to access browser APIs (localStorage, URLSearchParams)
- Fires before first render

## Examples

See `src/SharedSpaces.Client/src/features/join/join-view.ts` for a complete implementation:
- Two-mode form (paste vs manual)
- URL query param pre-fill
- localStorage-backed display name
- Loading states during token exchange
- Error handling for multiple HTTP status codes

## Anti-Patterns

### ❌ Don't use `@property` for internal state
```typescript
// BAD: Exposes internal state as attribute
@property({ type: String }) private username = '';
```

### ❌ Don't mutate state objects directly
```typescript
// BAD: Object mutation doesn't trigger re-render
this.formData.username = 'new value';

// GOOD: Replace entire object
this.formData = { ...this.formData, username: 'new value' };
```

### ❌ Don't forget to disable inputs during async operations
```typescript
// BAD: User can click submit multiple times
<button @click=${this.handleSubmit}>Submit</button>

// GOOD: Disable during loading
<button @click=${this.handleSubmit} ?disabled=${this.isLoading}>
  ${this.isLoading ? 'Submitting...' : 'Submit'}
</button>
```

### ❌ Don't clear the entire form on every input change
```typescript
// BAD: Loses all other field values
private handleUsernameInput = (e: Event) => {
  this.username = '';
  this.username = (e.target as HTMLInputElement).value;
};

// GOOD: Only update the specific field
private handleUsernameInput = (e: Event) => {
  this.username = (e.target as HTMLInputElement).value;
};
```

### ❌ Don't forget to clear errors on user input
```typescript
// BAD: Error stays visible even after user starts typing
private handleInput = (e: Event) => {
  this.username = (e.target as HTMLInputElement).value;
};

// GOOD: Clear error to give user immediate feedback
private handleInput = (e: Event) => {
  this.username = (e.target as HTMLInputElement).value;
  this.errorMessage = ''; // User is taking corrective action
};
```
