namespace SharedSpaces.Server.Domain;

public class SpaceMember
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid SpaceId { get; set; }
    public string DisplayName { get; set; } = string.Empty;
    public DateTime JoinedAt { get; set; } = DateTime.UtcNow;
    public bool IsRevoked { get; set; }
    public Space Space { get; set; } = null!;
    public ICollection<SpaceItem> Items { get; set; } = [];
}
