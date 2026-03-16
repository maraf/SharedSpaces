namespace SharedSpaces.Server.Domain;

public class Space
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public ICollection<SpaceInvitation> Invitations { get; set; } = [];
    public ICollection<SpaceMember> Members { get; set; } = [];
    public ICollection<SpaceItem> Items { get; set; } = [];
}
