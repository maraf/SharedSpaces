namespace SharedSpaces.Server.Domain;

public class SpaceInvitation
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid SpaceId { get; set; }
    public string Pin { get; set; } = string.Empty;
    public Space Space { get; set; } = null!;
}
