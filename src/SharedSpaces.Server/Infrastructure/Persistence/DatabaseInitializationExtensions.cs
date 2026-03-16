using Microsoft.EntityFrameworkCore;

namespace SharedSpaces.Server.Infrastructure.Persistence;

public static class DatabaseInitializationExtensions
{
    public static async Task InitializeDatabaseAsync(this WebApplication app)
    {
        using var scope = app.Services.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        if (dbContext.Database.IsRelational())
        {
            await dbContext.Database.MigrateAsync();
            return;
        }

        await dbContext.Database.EnsureCreatedAsync();
    }
}
