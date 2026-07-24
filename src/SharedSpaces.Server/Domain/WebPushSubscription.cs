namespace SharedSpaces.Server.Domain;

public class WebPushSubscription
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid SpaceId { get; set; }
    public Guid MemberId { get; set; }
    public string Endpoint { get; set; } = string.Empty;
    public string P256Dh { get; set; } = string.Empty;
    public string Auth { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public Space Space { get; set; } = null!;
    public SpaceMember Member { get; set; } = null!;
}
