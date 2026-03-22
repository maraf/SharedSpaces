import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SpaceResponse } from './admin-api';

// Mock the admin-api module (admin-view imports it for API calls)
vi.mock('./admin-api', () => ({
  AdminApiError: class extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  listSpaces: vi.fn().mockResolvedValue([]),
  createSpace: vi.fn(),
  createInvitation: vi.fn(),
  deleteInvitation: vi.fn(),
  listInvitations: vi.fn().mockResolvedValue([]),
  listMembers: vi.fn().mockResolvedValue([]),
  removeMember: vi.fn(),
  revokeMember: vi.fn(),
  unrevokeMember: vi.fn(),
}));

// Mock admin-url-storage (used in connectedCallback)
vi.mock('../../lib/admin-url-storage', () => ({
  getAdminServerUrls: vi.fn().mockReturnValue([]),
  addAdminServerUrl: vi.fn(),
  removeAdminServerUrl: vi.fn(),
}));

import './admin-view';
import { AdminView } from './admin-view';

function makeSpace(overrides: Partial<SpaceResponse> & { name: string }): SpaceResponse {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    name: overrides.name,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    maxUploadSize: overrides.maxUploadSize ?? null,
    effectiveMaxUploadSize: overrides.effectiveMaxUploadSize ?? 10_485_760,
  };
}

describe('AdminView — Alphabetical Space Sorting (Issue #96)', () => {
  let element: AdminView;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (element?.parentNode) {
      element.remove();
    }
    vi.restoreAllMocks();
  });

  function createElement(): AdminView {
    element = document.createElement('admin-view') as AdminView;
    document.body.appendChild(element);
    return element;
  }

  function getSpaceNames(): string[] {
    return ((element as any).spaces as SpaceResponse[]).map((s) => s.name);
  }

  // ── Core sorting ──────────────────────────────────────────────────

  it('sorts spaces alphabetically when set via setSpaces', async () => {
    createElement();
    await element.updateComplete;

    const unordered = [
      makeSpace({ name: 'Charlie' }),
      makeSpace({ name: 'Alpha' }),
      makeSpace({ name: 'Bravo' }),
    ];

    (element as any).setSpaces(unordered);
    await element.updateComplete;

    expect(getSpaceNames()).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('sorts case-insensitively', async () => {
    createElement();
    await element.updateComplete;

    const spaces = [
      makeSpace({ name: 'zebra' }),
      makeSpace({ name: 'Alpha' }),
      makeSpace({ name: 'mango' }),
      makeSpace({ name: 'Bravo' }),
    ];

    (element as any).setSpaces(spaces);
    await element.updateComplete;

    expect(getSpaceNames()).toEqual(['Alpha', 'Bravo', 'mango', 'zebra']);
  });

  it('handles empty space list', async () => {
    createElement();
    await element.updateComplete;

    (element as any).setSpaces([]);
    await element.updateComplete;

    expect(getSpaceNames()).toEqual([]);
  });

  it('handles single space', async () => {
    createElement();
    await element.updateComplete;

    (element as any).setSpaces([makeSpace({ name: 'Solo' })]);
    await element.updateComplete;

    expect(getSpaceNames()).toEqual(['Solo']);
  });

  // ── Edge cases ────────────────────────────────────────────────────

  it('sorts names with special characters', async () => {
    createElement();
    await element.updateComplete;

    const spaces = [
      makeSpace({ name: 'Zulu' }),
      makeSpace({ name: '!Important' }),
      makeSpace({ name: '#General' }),
      makeSpace({ name: 'Alpha' }),
    ];

    (element as any).setSpaces(spaces);
    await element.updateComplete;

    const names = getSpaceNames();
    expect(names.indexOf('Alpha')).toBeLessThan(names.indexOf('Zulu'));
    expect(names).toHaveLength(4);
  });

  it('sorts names with accented characters using locale-aware comparison', async () => {
    createElement();
    await element.updateComplete;

    const spaces = [
      makeSpace({ name: 'Élan' }),
      makeSpace({ name: 'Alpha' }),
      makeSpace({ name: 'Zulu' }),
    ];

    (element as any).setSpaces(spaces);
    await element.updateComplete;

    const names = getSpaceNames();
    expect(names.indexOf('Alpha')).toBeLessThan(names.indexOf('Zulu'));
    expect(names).toHaveLength(3);
  });

  it('sorts duplicate names stably (all present)', async () => {
    createElement();
    await element.updateComplete;

    const team1 = makeSpace({ name: 'Team' });
    const team2 = makeSpace({ name: 'Team' });

    (element as any).setSpaces([team1, team2, makeSpace({ name: 'Alpha' })]);
    await element.updateComplete;

    const names = getSpaceNames();
    expect(names[0]).toBe('Alpha');
    expect(names.filter((n) => n === 'Team')).toHaveLength(2);
  });

  // ── Dynamic updates: new space maintains sort order ───────────────

  it('inserts newly created space in sorted position', async () => {
    createElement();
    await element.updateComplete;

    // Initial spaces
    (element as any).setSpaces([
      makeSpace({ name: 'Alpha' }),
      makeSpace({ name: 'Charlie' }),
    ]);
    await element.updateComplete;
    expect(getSpaceNames()).toEqual(['Alpha', 'Charlie']);

    // Simulate creating a new space (handleCreateSpace calls setSpaces([space, ...this.spaces]))
    const newSpace = makeSpace({ name: 'Bravo' });
    const currentSpaces = (element as any).spaces as SpaceResponse[];
    (element as any).setSpaces([newSpace, ...currentSpaces]);
    await element.updateComplete;

    // Bravo should be sorted between Alpha and Charlie
    expect(getSpaceNames()).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('inserts space with name that sorts first', async () => {
    createElement();
    await element.updateComplete;

    (element as any).setSpaces([
      makeSpace({ name: 'Mango' }),
      makeSpace({ name: 'Zulu' }),
    ]);
    await element.updateComplete;

    const newSpace = makeSpace({ name: 'Alpha' });
    const currentSpaces = (element as any).spaces as SpaceResponse[];
    (element as any).setSpaces([newSpace, ...currentSpaces]);
    await element.updateComplete;

    expect(getSpaceNames()).toEqual(['Alpha', 'Mango', 'Zulu']);
  });

  it('inserts space with name that sorts last', async () => {
    createElement();
    await element.updateComplete;

    (element as any).setSpaces([
      makeSpace({ name: 'Alpha' }),
      makeSpace({ name: 'Bravo' }),
    ]);
    await element.updateComplete;

    const newSpace = makeSpace({ name: 'Zulu' });
    const currentSpaces = (element as any).spaces as SpaceResponse[];
    (element as any).setSpaces([newSpace, ...currentSpaces]);
    await element.updateComplete;

    expect(getSpaceNames()).toEqual(['Alpha', 'Bravo', 'Zulu']);
  });

  // ── Property-level order (backing the card list render) ─────────

  it('spaces property drives space card render order', async () => {
    // The template iterates this.spaces.map(space => this.renderSpaceCard(space))
    // — verifying the array is sorted is equivalent to verifying rendered card order.
    createElement();
    await element.updateComplete;

    const spaceC = makeSpace({ name: 'Charlie' });
    const spaceA = makeSpace({ name: 'Alpha' });
    const spaceB = makeSpace({ name: 'Bravo' });

    (element as any).setSpaces([spaceC, spaceA, spaceB]);
    await element.updateComplete;

    const spaces = (element as any).spaces as SpaceResponse[];
    expect(spaces.map((s) => s.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    // Verify IDs follow the same sorted order
    expect(spaces.map((s) => s.id)).toEqual([spaceA.id, spaceB.id, spaceC.id]);
  });
});
