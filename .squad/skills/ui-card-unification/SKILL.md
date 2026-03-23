---
name: "ui-card-unification"
description: "Extract shared card layouts into unified rendering functions to prevent UI drift"
domain: "ui-patterns, code-reuse"
confidence: "high"
source: "earned"
---

## Context

When a UI card structure appears in multiple contexts (e.g., regular items list + pending shares list), duplicating the card HTML leads to layout drift over time. One context gets updated with new styling while others lag behind, creating UX inconsistencies.

This skill applies when:
- The same card/list-item structure renders in 2+ places
- Cards share structure (container, layout) but differ in content
- You want to prevent future styling regressions

## Patterns

### 1. Extract Card Shell into Unified Function

Move the outer container and layout structure into a shared method:

```typescript
/**
 * Renders a unified item card layout used for both shared items and pending shares.
 * Prevents layout drift between different item display contexts.
 */
private renderUnifiedItemCard(content: unknown, overlay?: unknown) {
  return html`
    <li class="relative overflow-hidden rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3">
      <div class="flex items-center gap-3">
        ${content}
      </div>
      ${overlay ? overlay : nothing}
    </li>
  `;
}
```

### 2. Compose Content, Pass to Unified Function

Each context builds its own content template, then delegates to the unified card:

```typescript
private renderItemCard(item: SpaceItemResponse) {
  const content = item.contentType === 'file' 
    ? this.renderFileContent(item)
    : this.renderTextContent(item);
  const overlay = this.deleteConfirmItemId === item.id 
    ? this.renderDeleteConfirmOverlay(item) 
    : undefined;

  return this.renderUnifiedItemCard(content, overlay);
}
```

```typescript
private renderPendingShareCard(share: PendingShareItem) {
  const icon = share.type === 'file' 
    ? getFileTypeIcon(share.fileName ?? 'file')
    : getTextItemIcon();
  
  const content = html`
    <div class="shrink-0 ${icon.colorClass}">${icon.svg}</div>
    <div class="min-w-0 flex-1">
      <p class="truncate text-sm">${share.fileName ?? share.content}</p>
    </div>
    <!-- actions -->
  `;

  return this.renderUnifiedItemCard(content);
}
```

### 3. Name Unified Functions Clearly

Use `renderUnified*` prefix to signal that multiple contexts rely on this function:
- `renderUnifiedItemCard()`
- `renderUnifiedModal()`
- `renderUnifiedPill()`

Add JSDoc explaining **why** it's unified (e.g., "Prevents layout drift").

## Examples

**Real implementation:** `src/SharedSpaces.Client/src/features/space-view/space-view.ts` (line 1038)

Before unification:
- Regular items: `border-slate-800 bg-slate-900/60 px-4 py-3`
- Pending shares: `border-slate-700/50 bg-slate-900/40 px-3 py-2`

After unification:
- Both use `renderUnifiedItemCard()` with identical styling
- Future changes only need one edit

## Anti-Patterns

❌ **Don't duplicate card HTML in multiple places**
```typescript
// Bad: layout drift waiting to happen
return html`
  <li class="border bg-slate-900 px-3 py-2">...</li>  // in context A
`;
// ...later, elsewhere...
return html`
  <li class="border-2 bg-slate-800 px-4 py-3">...</li>  // in context B
`;
```

❌ **Don't over-abstract** — Only unify when you have 2+ actual use cases, not speculatively.

❌ **Don't pass entire objects** — Pass templates (`content`, `overlay`) not raw data. This keeps the unified function presentational.

## Related Skills

- **Component Composition** — Breaking UI into small, reusable pieces
- **Template Parameters** — Lit's `html` templates as first-class values
- **DRY Principle** — Don't Repeat Yourself applies to markup too
