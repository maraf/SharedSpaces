using System.Text.Json;
using SharedSpaces.Cli.Core.Models;

namespace SharedSpaces.Cli.Core.Services;

public sealed class ConfigService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true
    };

    private readonly string _configDir;
    private readonly string _configPath;

    public ConfigService()
        : this(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".sharedspaces"))
    {
    }

    public ConfigService(string configDir)
    {
        _configDir = configDir;
        _configPath = Path.Combine(_configDir, "config.json");
    }

    public async Task<CliConfig> LoadAsync(CancellationToken ct = default)
    {
        if (!File.Exists(_configPath))
            return new CliConfig();

        await using var stream = File.OpenRead(_configPath);
        return await JsonSerializer.DeserializeAsync<CliConfig>(stream, JsonOptions, ct) ?? new CliConfig();
    }

    public async Task SaveAsync(CliConfig config, CancellationToken ct = default)
    {
        Directory.CreateDirectory(_configDir);

        await using var stream = File.Create(_configPath);
        await JsonSerializer.SerializeAsync(stream, config, JsonOptions, ct);
    }

    public async Task<SpaceEntry?> GetSpaceAsync(string spaceId, CancellationToken ct = default)
    {
        var config = await LoadAsync(ct);
        return config.Spaces.Find(s => s.SpaceId.Equals(spaceId, StringComparison.OrdinalIgnoreCase));
    }

    public async Task UpsertSpaceAsync(SpaceEntry entry, CancellationToken ct = default)
    {
        var config = await LoadAsync(ct);
        config.Spaces.RemoveAll(s => s.SpaceId.Equals(entry.SpaceId, StringComparison.OrdinalIgnoreCase));
        config.Spaces.Add(entry);
        await SaveAsync(config, ct);
    }
}
