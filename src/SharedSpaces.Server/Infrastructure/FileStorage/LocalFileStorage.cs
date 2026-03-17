namespace SharedSpaces.Server.Infrastructure.FileStorage;

public sealed class LocalFileStorage : IFileStorage
{
    private const string DefaultBasePath = "./storage";
    private readonly string _basePath;
    private readonly string _normalizedBasePath;

    public LocalFileStorage(IConfiguration configuration, IHostEnvironment environment)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        ArgumentNullException.ThrowIfNull(environment);

        var configuredBasePath = configuration["Storage:BasePath"];
        var basePath = string.IsNullOrWhiteSpace(configuredBasePath)
            ? DefaultBasePath
            : configuredBasePath;

        _basePath = Path.GetFullPath(
            Path.IsPathRooted(basePath)
                ? basePath
                : Path.Combine(environment.ContentRootPath, basePath));

        Directory.CreateDirectory(_basePath);
        _normalizedBasePath = _basePath.EndsWith(Path.DirectorySeparatorChar)
            ? _basePath
            : _basePath + Path.DirectorySeparatorChar;
    }

    public async Task<string> SaveAsync(Guid spaceId, Guid itemId, Stream content, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(content);

        var fileName = $"{Guid.NewGuid():N}.bin";
        var relativePath = Path.Combine(spaceId.ToString(), itemId.ToString(), fileName);
        var fullPath = ResolveFullPath(relativePath);
        var directoryPath = Path.GetDirectoryName(fullPath)
            ?? throw new InvalidOperationException("Could not resolve the storage directory.");

        Directory.CreateDirectory(directoryPath);

        try
        {
            await using var output = new FileStream(fullPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, useAsync: true);
            await content.CopyToAsync(output, ct);
            return relativePath;
        }
        catch
        {
            if (File.Exists(fullPath))
            {
                File.Delete(fullPath);
                DeleteDirectoryIfEmpty(directoryPath);
                DeleteDirectoryIfEmpty(Path.GetDirectoryName(directoryPath));
            }

            throw;
        }
    }

    public Task<Stream> ReadAsync(string path, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();

        var fullPath = ResolveFullPath(path);
        Stream stream = new FileStream(fullPath, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, useAsync: true);
        return Task.FromResult(stream);
    }

    public Task DeleteAsync(string path, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();

        if (string.IsNullOrWhiteSpace(path))
        {
            return Task.CompletedTask;
        }

        var fullPath = ResolveFullPath(path);
        if (!File.Exists(fullPath))
        {
            return Task.CompletedTask;
        }

        File.Delete(fullPath);
        DeleteDirectoryIfEmpty(Path.GetDirectoryName(fullPath));
        DeleteDirectoryIfEmpty(Path.GetDirectoryName(Path.GetDirectoryName(fullPath)));

        return Task.CompletedTask;
    }

    private string ResolveFullPath(string path)
    {
        if (string.IsNullOrWhiteSpace(path))
        {
            throw new InvalidOperationException("Storage path is required.");
        }

        var fullPath = Path.GetFullPath(Path.Combine(_basePath, path));
        if (!fullPath.StartsWith(_normalizedBasePath, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("Storage path must stay within the configured base path.");
        }

        return fullPath;
    }

    private static void DeleteDirectoryIfEmpty(string? path)
    {
        if (string.IsNullOrWhiteSpace(path) || !Directory.Exists(path))
        {
            return;
        }

        if (Directory.EnumerateFileSystemEntries(path).Any())
        {
            return;
        }

        Directory.Delete(path);
    }
}
