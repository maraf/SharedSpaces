namespace SharedSpaces.Server.Infrastructure.FileStorage;

public sealed class StorageOptions
{
    public required string BasePath { get; set; }
    public long MaxSpaceQuotaBytes { get; set; } = 104_857_600L;
}
