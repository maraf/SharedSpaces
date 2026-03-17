using Microsoft.AspNetCore.Http;

namespace SharedSpaces.Server.Features.Items;

public sealed class UpsertSpaceItemRequest
{
    public Guid Id { get; init; }
    public string ContentType { get; init; } = string.Empty;
    public string? Content { get; init; }
    public IFormFile? File { get; init; }
}

public sealed record SpaceDetailsResponse(Guid Id, string Name, DateTime CreatedAt);

public sealed record SpaceItemResponse(
    Guid Id,
    Guid SpaceId,
    Guid MemberId,
    string ContentType,
    string Content,
    long FileSize,
    DateTime SharedAt);
