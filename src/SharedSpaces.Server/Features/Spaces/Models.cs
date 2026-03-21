namespace SharedSpaces.Server.Features.Spaces;

public record CreateSpaceRequest(string Name, long? MaxUploadSize = null);

public record SpaceResponse(Guid Id, string Name, DateTime CreatedAt, long? MaxUploadSize, long EffectiveMaxUploadSize);

public record MemberResponse(Guid Id, string DisplayName, DateTime JoinedAt, bool IsRevoked, int ItemCount);
