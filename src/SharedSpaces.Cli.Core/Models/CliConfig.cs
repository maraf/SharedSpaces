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

    private string GetClaim(string claimType)
    {
        var handler = new JwtSecurityTokenHandler();
        if (handler.CanReadToken(JwtToken))
        {
            var token = handler.ReadJwtToken(JwtToken);
            return token.Claims.FirstOrDefault(c => c.Type == claimType)?.Value ?? string.Empty;
        }
        return string.Empty;
    }
}
