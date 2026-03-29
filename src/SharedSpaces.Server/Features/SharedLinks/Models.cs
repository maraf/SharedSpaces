namespace SharedSpaces.Server.Features.SharedLinks;

public sealed record SharedLinkResponse(
    Guid Id,
    Guid Token,
    Guid SpaceId,
    Guid ItemId,
    Guid CreatedBy,
    DateTime CreatedAt);

public sealed record SharedItemResponse(
    string ContentType,
    string Content,
    long FileSize,
    DateTime SharedAt);
