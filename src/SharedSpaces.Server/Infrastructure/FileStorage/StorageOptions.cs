namespace SharedSpaces.Server.Infrastructure.FileStorage;

public sealed class StorageOptions
{
    public string BasePath { get; set; } = "./artifacts/storage";
    public long MaxSpaceQuotaBytes { get; set; } = 104_857_600L;
}
