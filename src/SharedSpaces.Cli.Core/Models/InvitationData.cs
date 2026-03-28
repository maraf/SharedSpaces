namespace SharedSpaces.Cli.Core.Models;

public sealed class InvitationData
{
    public required string ServerUrl { get; init; }
    public string? SpaceId { get; init; }
    public string? Pin { get; init; }
}
