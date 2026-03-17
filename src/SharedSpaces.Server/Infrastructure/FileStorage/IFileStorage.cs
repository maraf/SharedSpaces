namespace SharedSpaces.Server.Infrastructure.FileStorage;

public interface IFileStorage
{
    Task<string> SaveAsync(Guid spaceId, Guid itemId, Stream content, CancellationToken ct);
    Task<Stream> ReadAsync(string path, CancellationToken ct);
    Task DeleteAsync(string path, CancellationToken ct);
}
