namespace SharedSpaces.Server.Features.Tokens;

public record CreateTokenRequest(string Pin, string DisplayName, Guid? SpaceId = null);

public record TokenResponse(string Token);
