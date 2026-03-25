using System.Text.Json.Serialization;

namespace SharedSpaces.Cli.Core.Models;

public sealed class CliConfig
{
    [JsonPropertyName("spaces")]
    public List<SpaceEntry> Spaces { get; set; } = [];
}

public sealed class SpaceEntry
{
    [JsonPropertyName("space-id")]
    public required string SpaceId { get; set; }

    [JsonPropertyName("server-url")]
    public required string ServerUrl { get; set; }

    [JsonPropertyName("jwt-token")]
    public required string JwtToken { get; set; }

    [JsonPropertyName("display-name")]
    public required string DisplayName { get; set; }

    [JsonPropertyName("joined-at")]
    public required DateTime JoinedAt { get; set; }
}
