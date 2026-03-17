namespace SharedSpaces.Server.Features.Hubs;

public record ItemAddedEvent(
    Guid Id,
    Guid SpaceId,
    Guid MemberId,
    string DisplayName,
    string ContentType,
    string Content,
    long FileSize,
    DateTime SharedAt);

public record ItemDeletedEvent(
    Guid Id,
    Guid SpaceId);
