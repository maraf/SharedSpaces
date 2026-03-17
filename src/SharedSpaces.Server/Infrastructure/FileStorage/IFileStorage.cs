namespace SharedSpaces.Server.Infrastructure.FileStorage;

public interface IFileStorage
{
    Task SaveAsync(Guid spaceId, Guid itemId, Stream content, CancellationToken ct);
    Task<Stream> ReadAsync(Guid spaceId, Guid itemId, CancellationToken ct);
    Task DeleteAsync(Guid spaceId, Guid itemId, CancellationToken ct);
}
