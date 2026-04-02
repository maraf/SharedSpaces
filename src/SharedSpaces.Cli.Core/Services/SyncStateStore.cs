using System.Text.Json;

namespace SharedSpaces.Cli.Core.Services;

internal sealed class SyncStateStore
{
    public const string FileName = ".sharedspaces-sync.json";
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true
    };

    private readonly string _statePath;
    private readonly object _gate = new();

    public SyncStateStore(string localFolder)
    {
        _statePath = Path.Combine(localFolder, FileName);
    }

    public SyncStateSnapshot Load()
    {
        lock (_gate)
        {
            if (!File.Exists(_statePath))
                return new SyncStateSnapshot();

            try
            {
                var json = File.ReadAllText(_statePath);
                return JsonSerializer.Deserialize<SyncStateSnapshot>(json, JsonOptions) ?? new SyncStateSnapshot();
            }
            catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException)
            {
                Console.Error.WriteLine($"[State] Failed to read sync state: {ex.Message}");
                return new SyncStateSnapshot();
            }
        }
    }

    public void Save(IReadOnlyDictionary<Guid, string> trackedItems, DateTime? lastAppliedCheckpointUtc)
    {
        lock (_gate)
        {
            try
            {
                var snapshot = new SyncStateSnapshot
                {
                    LastAppliedCheckpointUtc = lastAppliedCheckpointUtc,
                    TrackedItems = trackedItems
                        .Where(entry => !string.IsNullOrWhiteSpace(entry.Value))
                        .ToDictionary(entry => entry.Key, entry => entry.Value)
                };

                Directory.CreateDirectory(Path.GetDirectoryName(_statePath)!);

                var tempPath = $"{_statePath}.tmp";
                var json = JsonSerializer.Serialize(snapshot, JsonOptions);
                File.WriteAllText(tempPath, json);
                File.Move(tempPath, _statePath, overwrite: true);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                Console.Error.WriteLine($"[State] Failed to save sync state: {ex.Message}");
            }
        }
    }
}

internal sealed class SyncStateSnapshot
{
    public DateTime? LastAppliedCheckpointUtc { get; set; }

    public Dictionary<Guid, string> TrackedItems { get; set; } = new();
}
