namespace SharedSpaces.Server.Domain;

public class SpaceItem
{
    public Guid Id { get; set; }
    public Guid SpaceId { get; set; }
    public Guid MemberId { get; set; }
    public string ContentType { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public DateTime SharedAt { get; set; } = DateTime.UtcNow;
    public Space Space { get; set; } = null!;
    public SpaceMember Member { get; set; } = null!;
}
