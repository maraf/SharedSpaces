namespace SharedSpaces.Server.Domain;

public class DeletedItem
{
    public Guid ItemId { get; set; }
    public Guid SpaceId { get; set; }
    public DateTime DeletedAt { get; set; } = DateTime.UtcNow;
    public Space Space { get; set; } = null!;
}
