using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;

namespace SharedSpaces.Server.Infrastructure.Persistence;

public sealed class AppDbContextFactory : IDesignTimeDbContextFactory<AppDbContext>
{
    public AppDbContext CreateDbContext(string[] args)
    {
        var basePath = ResolveBasePath();
        var environmentName = ResolveEnvironmentName();
        var configuration = new ConfigurationBuilder()
            .SetBasePath(basePath)
            .AddJsonFile("appsettings.json", optional: false)
            .AddJsonFile($"appsettings.{environmentName}.json", optional: true)
            .AddEnvironmentVariables()
            .Build();

        var rawConnectionString = configuration.GetConnectionString(PersistenceServiceCollectionExtensions.DefaultConnectionStringName)
            ?? throw new InvalidOperationException($"Connection string '{PersistenceServiceCollectionExtensions.DefaultConnectionStringName}' was not found.");

        var connectionString = SqliteConnectionStringResolver.Resolve(rawConnectionString, basePath);

        var optionsBuilder = new DbContextOptionsBuilder<AppDbContext>();
        optionsBuilder.UseSqlite(connectionString);

        return new AppDbContext(optionsBuilder.Options);
    }

    private static string ResolveBasePath()
    {
        var currentDirectory = Directory.GetCurrentDirectory();
        var candidates = new[]
        {
            currentDirectory,
            Path.Combine(currentDirectory, "src", "SharedSpaces.Server"),
            AppContext.BaseDirectory
        };

        return candidates.FirstOrDefault(path => File.Exists(Path.Combine(path, "appsettings.json")))
            ?? throw new InvalidOperationException("Could not locate appsettings.json for design-time AppDbContext creation.");
    }

    private static string ResolveEnvironmentName()
    {
        return Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") is { Length: > 0 } environmentName
            ? environmentName
            : "Development";
    }
}
