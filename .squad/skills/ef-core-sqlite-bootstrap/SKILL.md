---
name: "ef-core-sqlite-bootstrap"
description: "How SharedSpaces wires EF Core SQLite persistence into the ASP.NET Core server scaffold"
domain: "backend"
confidence: "high"
source: "observed"
---

## Context

Use this skill when adding or extending persistence in `src/SharedSpaces.Server/`. The project uses EF Core with SQLite for local development, but keeps the persistence layout provider-agnostic enough to swap providers later.

## Patterns

### Persistence layout
- Keep `AppDbContext`, design-time factory, startup registration, and migration helpers in `src/SharedSpaces.Server/Infrastructure/Persistence/`.
- Put entity-specific `IEntityTypeConfiguration<T>` classes under `Infrastructure/Persistence/Configurations/`.
- Keep generated migrations under `Infrastructure/Persistence/Migrations/` so schema history stays close to the DbContext.

### Configuration and startup
- Read the connection string from `ConnectionStrings:DefaultConnection` in `appsettings.json`; do not hardcode SQLite paths in code.
- Normalize relative SQLite `Data Source` values through `SqliteConnectionStringResolver` so `dotnet run` and `dotnet ef` use the same file location.
- Apply pending migrations at startup with `DatabaseInitializationExtensions.InitializeDatabaseAsync()` before mapping endpoints.

### Domain modeling
- Keep domain entities in `Domain/` with GUID keys and navigation properties.
- Use fluent EF configuration for required fields, FK relationships, and GUID key generation rules instead of data annotations.

## Examples

- `src/SharedSpaces.Server/Infrastructure/Persistence/AppDbContext.cs`
- `src/SharedSpaces.Server/Infrastructure/Persistence/AppDbContextFactory.cs`
- `src/SharedSpaces.Server/Infrastructure/Persistence/SqliteConnectionStringResolver.cs`
- `src/SharedSpaces.Server/Infrastructure/Persistence/Configurations/SpaceItemConfiguration.cs`

## Anti-Patterns

- Hardcoding SQLite file paths directly in `Program.cs` or the DbContext factory.
- Mixing EF Core mapping attributes into domain entities when the project already uses fluent configuration classes.
- Leaving migrations outside `Infrastructure/Persistence/Migrations/`, which makes schema history harder to discover.
