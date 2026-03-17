using Microsoft.Extensions.Options;

namespace SharedSpaces.Server.Infrastructure.FileStorage;

public sealed class LocalFileStorage : IFileStorage
{
    private readonly string _basePath;

    public LocalFileStorage(IOptions<StorageOptions> options, IHostEnvironment environment)
    {
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(environment);

        var configuredBasePath = options.Value.BasePath;
        if (string.IsNullOrWhiteSpace(configuredBasePath))
        {
            throw new InvalidOperationException("Storage:BasePath must be configured with a non-empty path.");
        }

        _basePath = Path.GetFullPath(
            Path.IsPathRooted(configuredBasePath)
                ? configuredBasePath
                : Path.Combine(environment.ContentRootPath, configuredBasePath));

        Directory.CreateDirectory(_basePath);
    }

    public async Task SaveAsync(Guid spaceId, Guid itemId, Stream content, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(content);

        var directoryPath = Path.Combine(_basePath, spaceId.ToString());
        Directory.CreateDirectory(directoryPath);

        var fullPath = Path.Combine(directoryPath, $"{itemId}.bin");

        try
        {
            await using var output = new FileStream(fullPath, FileMode.Create, FileAccess.Write, FileShare.None, 81920, useAsync: true);
            await content.CopyToAsync(output, ct);
        }
        catch
        {
            try
            {
                if (File.Exists(fullPath))
                {
                    File.Delete(fullPath);
                }
            }
            catch
            {
                // Best-effort cleanup
            }

            throw;
        }
    }

    public Task<Stream> ReadAsync(Guid spaceId, Guid itemId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();

        var fullPath = Path.Combine(_basePath, spaceId.ToString(), $"{itemId}.bin");
        Stream stream = new FileStream(fullPath, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, useAsync: true);
        return Task.FromResult(stream);
    }

    public Task DeleteAsync(Guid spaceId, Guid itemId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();

        var fullPath = Path.Combine(_basePath, spaceId.ToString(), $"{itemId}.bin");
        if (File.Exists(fullPath))
        {
            File.Delete(fullPath);
        }

        try
        {
            var directoryPath = Path.GetDirectoryName(fullPath);
            if (directoryPath is not null && Directory.Exists(directoryPath) && !Directory.EnumerateFileSystemEntries(directoryPath).Any())
            {
                Directory.Delete(directoryPath);
            }
        }
        catch
        {
            // Best-effort directory cleanup
        }

        return Task.CompletedTask;
    }
}
