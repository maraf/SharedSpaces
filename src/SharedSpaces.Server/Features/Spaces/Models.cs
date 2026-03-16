namespace SharedSpaces.Server.Features.Spaces;

public record CreateSpaceRequest(string Name);

public record SpaceResponse(Guid Id, string Name, DateTime CreatedAt);
