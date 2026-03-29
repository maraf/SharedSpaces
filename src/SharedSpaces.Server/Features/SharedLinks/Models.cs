namespace SharedSpaces.Server.Features.SharedLinks;

public sealed record SharedLinkResponse(
    Guid Id,
    Guid Token,
    Guid SpaceId,
    Guid ItemId,
    Guid CreatedBy,
    DateTimeOffset CreatedAt);

public sealed record SharedItemResponse(
    string ContentType,
    string Content,
    long FileSize,
    DateTimeOffset SharedAt);
