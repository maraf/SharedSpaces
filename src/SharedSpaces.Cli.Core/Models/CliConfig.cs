using System.IdentityModel.Tokens.Jwt;
using System.Text.Json.Serialization;

namespace SharedSpaces.Cli.Core.Models;

public sealed class CliConfig
{
    [JsonPropertyName("spaces")]
    public List<SpaceEntry> Spaces { get; set; } = [];
}

public sealed class SpaceEntry
{
    [JsonPropertyName("jwtToken")]
    public required string JwtToken { get; set; }

    [JsonIgnore]
    public string SpaceId => GetClaim("space_id");

    [JsonIgnore]
    public string ServerUrl => GetClaim("server_url");

    [JsonIgnore]
    public string DisplayName => GetClaim("display_name");

    [JsonIgnore]
    public string SpaceName => GetClaim("space_name");

    private string? _cachedJwtSource;
    private JwtSecurityToken? _cachedToken;

    private JwtSecurityToken? GetParsedToken()
    {
        if (_cachedToken is null || _cachedJwtSource != JwtToken)
        {
            var handler = new JwtSecurityTokenHandler();
            if (handler.CanReadToken(JwtToken))
            {
                _cachedToken = handler.ReadJwtToken(JwtToken);
                _cachedJwtSource = JwtToken;
            }
            else
            {
                _cachedToken = null;
                _cachedJwtSource = null;
            }
        }
        return _cachedToken;
    }

    private string GetClaim(string claimType)
    {
        return GetParsedToken()?.Claims.FirstOrDefault(c => c.Type == claimType)?.Value ?? string.Empty;
    }
}
