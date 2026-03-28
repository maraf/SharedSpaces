namespace SharedSpaces.Server.Domain;

public class SharedLink
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid Token { get; set; } = Guid.NewGuid();
    public Guid SpaceId { get; set; }
    public Guid ItemId { get; set; }
    public Guid CreatedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public Space Space { get; set; } = null!;
    public SpaceItem Item { get; set; } = null!;
    public SpaceMember Creator { get; set; } = null!;
}
