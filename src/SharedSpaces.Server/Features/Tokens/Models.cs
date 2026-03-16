namespace SharedSpaces.Server.Features.Tokens;

public record CreateTokenRequest(string Pin, string DisplayName);

public record TokenResponse(string Token);
