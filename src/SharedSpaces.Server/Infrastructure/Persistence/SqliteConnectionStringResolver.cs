using Microsoft.Data.Sqlite;

namespace SharedSpaces.Server.Infrastructure.Persistence;

internal static class SqliteConnectionStringResolver
{
    public static string Resolve(string connectionString, string basePath)
    {
        var builder = new SqliteConnectionStringBuilder(connectionString);

        if (!Path.IsPathRooted(builder.DataSource))
        {
            builder.DataSource = Path.GetFullPath(Path.Combine(basePath, builder.DataSource));
        }

        return builder.ToString();
    }
}
