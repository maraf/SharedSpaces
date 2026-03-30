namespace SharedSpaces.Server.Features.SharedLinks;

public sealed record CreateSharedLinkRequest(
    string? Name);

public sealed record SharedLinkResponse(
    Guid Id,
    Guid Token,
    Guid SpaceId,
    Guid ItemId,
    Guid CreatedBy,
    DateTime CreatedAt,
    string? Name,
    string? ServerUrl = null);

public sealed record SharedItemResponse(
    string ContentType,
    string Content,
    long FileSize,
    DateTime SharedAt);
