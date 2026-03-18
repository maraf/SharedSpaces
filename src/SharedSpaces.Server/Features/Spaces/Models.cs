namespace SharedSpaces.Server.Features.Spaces;

public record CreateSpaceRequest(string Name);

public record SpaceResponse(Guid Id, string Name, DateTime CreatedAt);

public record MemberResponse(Guid Id, string DisplayName, DateTime JoinedAt, bool IsRevoked);
