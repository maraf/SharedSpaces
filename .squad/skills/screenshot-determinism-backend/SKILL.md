---
name: "screenshot-determinism-backend"
description: "Backend perspective on E2E screenshot stability. Identifies churn sources and recommends server-side strategies."
domain: "testing"
confidence: "high"
source: "Investigation: Kaylee (2026-03-31) + Zoe (client-side skill doc)"
---

## The Problem

E2E screenshots churn on every run due to **server-generated timestamps** in API responses. When the frontend renders timestamps (relative time "Today", absolute time "3/19/2025, 2:47 PM"), changing wall-clock times cause pixel-perfect diffs to fail.

### High-Impact Sources

| Server Entity | Field | Problem | Impact |
|---------------|-------|---------|--------|
| `Space` | `CreatedAt = DateTime.UtcNow` | Admin view renders as `.toLocaleString()` | Monthly drift ("Mar 19" → "Apr 1") |
| `SpaceMember` | `JoinedAt = DateTime.UtcNow` | Admin members modal renders as `.toLocaleString()` | Monthly drift, width changes |
| `SpaceItem` | `SharedAt = DateTime.UtcNow` | space-view renders as relative time ("Today", "6d ago") | Daily to monthly drift |
| `SharedLink` | `CreatedAt = DateTime.UtcNow` | Shared item detail page timestamp | Monthly drift |
| All IDs | `Guid.NewGuid()` | Monospace, fixed-width but visible | Low impact; cosmetic diff noise |

### Code Locations

```csharp
// Domain/Space.cs:7
public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

// Domain/SpaceMember.cs:8
public DateTime JoinedAt { get; set; } = DateTime.UtcNow;

// Domain/SpaceItem.cs:30
public DateTime SharedAt { get; set; } = DateTime.UtcNow;

// Domain/SharedLink.cs:10
public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
```

---

## Current Approach: Client-Side Determinism (Zoe's Skill)

**Recommended:** Keep these defaults. Client-side fixture discipline solves the problem.

In `src/SharedSpaces.Client/e2e/screenshots.spec.ts`, the test harness:
1. Uses fixed seed dates (e.g., `new Date('2025-03-19T12:00:00Z')`)
2. Creates all items at predictable intervals (staggered by minutes)
3. Re-baselines screenshots when the calendar month changes (~quarterly)

**Why this is correct:**
- ✅ Server timestamps remain realistic for production
- ✅ UI captures real rendering (relative times, locale formatting)
- ✅ Zero product-code changes
- ✅ Re-baselining quarterly is acceptable maintenance

**Decision:** **Do NOT add clock abstraction or test endpoints to the backend.** Let the client harness own this problem.

---

## Backend Option: If Determinism Becomes Necessary

If, after 1–2 months, re-baselining every month is too expensive, add server-side clock injection:

### Option: `IDateTimeProvider` Injection

**When to implement:** Only if client-side re-baselining causes friction.

**How:** Create a clock abstraction, inject into entity initializers, override in tests.

#### Step 1: Create the interface

```csharp
// src/SharedSpaces.Server/Infrastructure/Clock/IDateTimeProvider.cs
public interface IDateTimeProvider
{
    DateTime UtcNow { get; }
}

public class SystemDateTimeProvider : IDateTimeProvider
{
    public DateTime UtcNow => DateTime.UtcNow;
}

public class TestDateTimeProvider : IDateTimeProvider
{
    private readonly DateTime _fixedTime;
    
    public TestDateTimeProvider(DateTime fixedTime) => _fixedTime = fixedTime;
    public DateTime UtcNow => _fixedTime;
}
```

#### Step 2: Register in DI

```csharp
// Program.cs
if (app.Environment.IsDevelopment() || app.Environment.IsEnvironment("Testing"))
{
    var fixedTime = new DateTime(2025, 3, 19, 12, 0, 0, DateTimeKind.Utc);
    services.AddSingleton<IDateTimeProvider>(new TestDateTimeProvider(fixedTime));
}
else
{
    services.AddSingleton<IDateTimeProvider, SystemDateTimeProvider>();
}
```

#### Step 3: Update entity defaults

Change initializers from direct `DateTime.UtcNow` to injected provider (requires DI in entity constructors or factory pattern):

```csharp
// Domain/Space.cs — Add optional ctor parameter
public Space(IDateTimeProvider? dateTimeProvider = null)
{
    CreatedAt = (dateTimeProvider ?? new SystemDateTimeProvider()).UtcNow;
}

// Or use a static helper if constructor injection is too heavy
public class DateTimeFactory
{
    private static IDateTimeProvider? _provider;
    
    public static void SetProvider(IDateTimeProvider provider) => _provider = provider;
    
    public static DateTime UtcNow => (_provider ?? new SystemDateTimeProvider()).UtcNow;
}

// Then in entities:
public DateTime CreatedAt { get; set; } = DateTimeFactory.UtcNow;
```

#### Step 4: Update test factory

```csharp
// tests/SharedSpaces.Server.Tests/TestWebApplicationFactory.cs
protected override void ConfigureWebHost(IWebHostBuilder builder)
{
    var fixedTime = new DateTime(2025, 3, 19, 12, 0, 0, DateTimeKind.Utc);
    var dateTimeProvider = new TestDateTimeProvider(fixedTime);
    
    builder.ConfigureServices(services =>
    {
        services.AddSingleton(dateTimeProvider);
    });
}
```

### Properties of This Approach

- **Risk:** Low. Changes isolated to initialization, no business logic affected.
- **Scope:** 5 domain files (Space, SpaceMember, SpaceItem, SharedLink, SpaceInvitation).
- **Timeline:** 1–2 hours.
- **Impact:** Permanent determinism. No more re-baselining.

---

## Rule: Keep Server Code Honest

**Never add test-only logic to production code paths.**

❌ Don't add `if (env.IsTesting())` guards in entity initializers  
❌ Don't add query parameters like `?seedTime=...` to production endpoints  
✅ **Do** use DI and test configuration to override non-production behavior  
✅ **Do** keep timestamps realistic (they're auditable, visible in logs, etc.)

---

## Monitoring

If new timestamp-sensitive code is added, apply the same discipline:

- **New entity with timestamps?** Use `IDateTimeProvider` (if backend determinism is active) or document for client-side seeding.
- **New temporal features (e.g., "last accessed at")?** Plan for test determinism upfront.
- **SignalR hub emits timestamps?** Coordinate with Zoe on whether client needs to mock them.

---

## Related Files

- **Client determinism:** `src/SharedSpaces.Client/e2e/screenshots.spec.ts` (Zoe's Tier 1)
- **Test factory:** `tests/SharedSpaces.Server.Tests/TokenEndpointTests.cs` (line 428+)
- **Entities:** `src/SharedSpaces.Server/Domain/{Space,SpaceMember,SpaceItem,SharedLink}.cs`
- **API responses:** `src/SharedSpaces.Server/Features/{Spaces,Items,SharedLinks}/Models.cs`

---

**Last Updated:** 2026-03-31 (Kaylee)  
**Status:** Do not implement backend changes yet. Client-side approach sufficient.
