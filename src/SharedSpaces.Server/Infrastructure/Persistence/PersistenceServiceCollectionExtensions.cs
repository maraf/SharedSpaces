using Microsoft.EntityFrameworkCore;

namespace SharedSpaces.Server.Infrastructure.Persistence;

public static class PersistenceServiceCollectionExtensions
{
    public const string DefaultConnectionStringName = "DefaultConnection";

    public static IServiceCollection AddPersistence(this IServiceCollection services, IConfiguration configuration, string contentRootPath)
    {
        var rawConnectionString = configuration.GetConnectionString(DefaultConnectionStringName)
            ?? throw new InvalidOperationException($"Connection string '{DefaultConnectionStringName}' was not found.");

        var connectionString = SqliteConnectionStringResolver.Resolve(rawConnectionString, contentRootPath);

        services.AddDbContext<AppDbContext>(options => options.UseSqlite(connectionString));

        return services;
    }
}
