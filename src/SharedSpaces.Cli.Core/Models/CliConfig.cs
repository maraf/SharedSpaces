using System.Text.Json.Serialization;

namespace SharedSpaces.Cli.Core.Models;

public sealed class CliConfig
{
    [JsonPropertyName("spaces")]
    public List<SpaceEntry> Spaces { get; set; } = [];
}

public sealed class SpaceEntry
{
    [JsonPropertyName("spaceId")]
    public required string SpaceId { get; set; }

    [JsonPropertyName("serverUrl")]
    public required string ServerUrl { get; set; }

    [JsonPropertyName("jwtToken")]
    public required string JwtToken { get; set; }

    [JsonPropertyName("displayName")]
    public required string DisplayName { get; set; }

    [JsonPropertyName("joinedAt")]
    public required DateTime JoinedAt { get; set; }
}
