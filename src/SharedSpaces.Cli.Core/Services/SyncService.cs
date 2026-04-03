using System.Collections.Concurrent;
using Microsoft.AspNetCore.SignalR.Client;

namespace SharedSpaces.Cli.Core.Services;

public sealed class SyncService : IAsyncDisposable
{
    private readonly SharedSpacesApiClient _apiClient;
    private readonly string _serverUrl;
    private readonly string _spaceId;
    private readonly Guid _spaceGuid;
    private readonly string _jwtToken;
    private readonly string _localFolder;
    private const double TimestampToleranceSeconds = 2;
    private readonly ConcurrentDictionary<Guid, string> _downloadedItems = new();
    private readonly ConcurrentDictionary<Guid, byte> _pendingUploads = new();
    private readonly ConcurrentDictionary<string, byte> _knownFiles = new(StringComparer.OrdinalIgnoreCase);
    private HubConnection? _hubConnection;
    private FileSystemWatcher? _watcher;
    private DateTime _lastDisconnect = DateTime.MinValue;
    private PeriodicTimer? _pollingTimer;
    private Task? _pollingTask;

    public SyncService(
        SharedSpacesApiClient apiClient,
        string serverUrl,
        string spaceId,
        string jwtToken,
        string localFolder)
    {
        _apiClient = apiClient;
        _serverUrl = serverUrl.TrimEnd('/');
        _spaceId = spaceId;
        _spaceGuid = Guid.TryParse(spaceId, out var parsedSpaceId)
            ? parsedSpaceId
            : throw new ArgumentException("spaceId must be a valid GUID.", nameof(spaceId));
        _jwtToken = jwtToken;
        _localFolder = localFolder;
    }

    public bool IsDownloaded(Guid itemId) => _downloadedItems.ContainsKey(itemId);

    public void MarkAsDownloaded(Guid itemId, string? filename = null)
    {
        _downloadedItems[itemId] = filename ?? string.Empty;

        if (!string.IsNullOrWhiteSpace(filename))
        {
            _knownFiles.TryAdd(filename, 0);
        }
    }

    public bool IsKnownFile(string filename) => _knownFiles.ContainsKey(filename);

    public async Task RunAsync(CancellationToken ct)
    {
        Console.WriteLine($"Starting sync for space {_spaceId}...");
        Console.WriteLine($"Local folder: {_localFolder}");

        ScanExistingFiles();
        await InitialSyncAsync(ct);
        await ConnectSignalRAsync(ct);
        StartFileWatcher(ct);

        try
        {
            await Task.Delay(Timeout.Infinite, ct);
        }
        catch (TaskCanceledException)
        {
            Console.WriteLine("Sync stopped.");
        }
    }

    public async Task InitialSyncAsync(CancellationToken ct)
    {
        Console.WriteLine("Performing initial sync...");

        var journal = await _apiClient.GetJournalAsync(_serverUrl, _spaceId, _jwtToken, ct);
        await PerformFullSyncAsync(journal.Checkpoint, ct);

        Console.WriteLine("Initial sync complete.");
    }

    public async Task OnItemAddedAsync(ItemAddedEvent itemAdded, CancellationToken ct)
    {
        Console.WriteLine($"[Event] ItemAdded: {itemAdded.Id} ({itemAdded.ContentType})");

        if (itemAdded.ContentType == "file")
        {
            await DownloadAndSaveFileAsync(itemAdded.Id, itemAdded.Content, itemAdded.FileSize, itemAdded.SharedAt, ct);
        }
    }

    public bool OnItemDeleted(ItemDeletedEvent itemDeleted)
    {
        Console.WriteLine($"[Event] ItemDeleted: {itemDeleted.Id}");
        return DeleteLocalItem(itemDeleted.Id, knownFilename: null);
    }

    private bool DeleteLocalItem(Guid itemId, string? knownFilename)
    {
        string? filename = knownFilename;

        if (filename is null)
        {
            if (!_downloadedItems.TryGetValue(itemId, out filename))
                return true;
        }

        if (!string.IsNullOrEmpty(filename))
        {
            var localPath = Path.Combine(_localFolder, filename);
            try
            {
                if (File.Exists(localPath))
                {
                    File.Delete(localPath);
                    Console.WriteLine($"[Delete] Deleted local file: {filename}");
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[Delete] Failed to delete {filename}: {ex.Message}");
                return false;
            }

            _knownFiles.TryRemove(filename, out _);
        }

        _downloadedItems.TryRemove(itemId, out _);
        return true;
    }

    private async Task ConnectSignalRAsync(CancellationToken ct)
    {
        var hubUrl = $"{_serverUrl}/v1/spaces/{_spaceId}/hub";
        Console.WriteLine($"Connecting to SignalR hub: {hubUrl}");

        _hubConnection = new HubConnectionBuilder()
            .WithUrl(hubUrl, options =>
            {
                options.AccessTokenProvider = () => Task.FromResult<string?>(_jwtToken);
            })
            .WithAutomaticReconnect()
            .Build();

        _hubConnection.On<ItemAddedEvent>("ItemAdded", async itemAdded =>
        {
            await OnItemAddedAsync(itemAdded, ct);
        });

        _hubConnection.On<ItemDeletedEvent>("ItemDeleted", itemDeleted =>
        {
            OnItemDeleted(itemDeleted);
        });

        _hubConnection.Reconnecting += error =>
        {
            if (ct.IsCancellationRequested)
                return Task.CompletedTask;

            Console.WriteLine($"[SignalR] Reconnecting... ({error?.Message ?? "unknown error"})");
            _lastDisconnect = DateTime.UtcNow;
            StartPolling(ct);
            return Task.CompletedTask;
        };

        _hubConnection.Reconnected += connectionId =>
        {
            Console.WriteLine($"[SignalR] Reconnected (connectionId: {connectionId})");
            _lastDisconnect = DateTime.MinValue;
            StopPolling();
            return Task.CompletedTask;
        };

        _hubConnection.Closed += async error =>
        {
            if (ct.IsCancellationRequested)
                return;

            // Do not restart polling on graceful/normal shutdown (e.g., DisposeAsync()).
            if (error is null)
            {
                Console.WriteLine("[SignalR] Connection closed gracefully.");
                return;
            }

            Console.WriteLine($"[SignalR] Connection closed ({error.Message})");
            _lastDisconnect = DateTime.UtcNow;
            StartPolling(ct);

            // Fix 1: Retry SignalR reconnection with exponential backoff
            var delays = new[] { 2, 5, 10, 30, 60 };
            foreach (var delaySec in delays)
            {
                if (ct.IsCancellationRequested)
                    break;

                try
                {
                    await Task.Delay(TimeSpan.FromSeconds(delaySec), ct);
                    await _hubConnection.StartAsync(ct);
                    Console.WriteLine("[SignalR] Reconnected successfully after retry.");
                    break;
                }
                catch (OperationCanceledException)
                {
                    break;
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine($"[SignalR] Reconnection retry failed ({delaySec}s delay): {ex.Message}");
                }
            }
        };

        try
        {
            await _hubConnection.StartAsync(ct);
            Console.WriteLine("[SignalR] Connected successfully.");
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[SignalR] Connection failed: {ex.Message}");
            _lastDisconnect = DateTime.UtcNow;
            StartPolling(ct);
        }
    }

    private void StartPolling(CancellationToken ct)
    {
        if (_pollingTimer != null)
            return;

        Console.WriteLine("[Polling] Starting HTTP polling fallback (every 5 seconds)...");

        var timer = new PeriodicTimer(TimeSpan.FromSeconds(5));
        _pollingTimer = timer;
        _pollingTask = PollLoopAsync(timer, ct);
    }

    private async Task PollLoopAsync(PeriodicTimer timer, CancellationToken ct)
    {
        while (await timer.WaitForNextTickAsync(ct).ConfigureAwait(false))
        {
            if ((DateTime.UtcNow - _lastDisconnect).TotalSeconds < 30)
                continue;

            Console.WriteLine("[Polling] Checking for changes...");

            try
            {
                var journal = await _apiClient.GetJournalAsync(_serverUrl, _spaceId, _jwtToken, ct);
                await ApplyRemoteChangesAsync(journal, forceFullSync: false, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                Console.Error.WriteLine($"[Polling] Failed: {ex.Message}");
            }
        }
    }

    private void StopPolling()
    {
        if (_pollingTimer == null)
            return;

        Console.WriteLine("[Polling] Stopping HTTP polling.");
        _pollingTimer?.Dispose();
        _pollingTimer = null;
    }

    private async Task<bool> DownloadAndSaveFileAsync(Guid itemId, string filename, long fileSize, DateTime sharedAt, CancellationToken ct)
    {
        var safeName = SanitizeFileName(filename, itemId);

        // Atomic claim — stores filename so deletion can map itemId → file
        if (!_downloadedItems.TryAdd(itemId, safeName))
        {
            Console.WriteLine($"[Download] Skipping already claimed item: {itemId}");
            return true;
        }

        try
        {
            var localPath = Path.Combine(_localFolder, safeName);

            // Skip download if local file matches server metadata
            if (File.Exists(localPath))
            {
                var localFile = new FileInfo(localPath);
                if (localFile.Length == fileSize
                    && Math.Abs((localFile.LastWriteTimeUtc - sharedAt).TotalSeconds) <= TimestampToleranceSeconds)
                {
                    Console.WriteLine($"[Download] Skipping unchanged file: {safeName}");
                    _knownFiles.TryAdd(safeName, 0);
                    return true;
                }
            }

            // Fix 6: Temp file
            var tempPath = Path.Combine(_localFolder, $".{itemId}.tmp");

            Console.WriteLine($"[Download] Downloading {safeName}...");

            try
            {
                // Fix 5 + 6: Stream directly to temp file
                await using (var tempFileStream = new FileStream(tempPath, FileMode.Create, FileAccess.Write, FileShare.None))
                {
                    await _apiClient.DownloadFileToAsync(_serverUrl, _spaceId, itemId.ToString(), _jwtToken, tempFileStream, ct);
                    await tempFileStream.FlushAsync(ct);
                }

                File.Move(tempPath, localPath, overwrite: true);
                File.SetLastWriteTimeUtc(localPath, sharedAt);
                Console.WriteLine($"[Download] Saved to {localPath}");

                // Track downloaded file to prevent upload loop
                _knownFiles.TryAdd(safeName, 0);
                return true;
            }
            catch
            {
                try { if (File.Exists(tempPath)) File.Delete(tempPath); } catch { }
                throw;
            }
        }
        catch (OperationCanceledException)
        {
            _downloadedItems.TryRemove(itemId, out _);
            throw;
        }
        catch (Exception ex)
        {
            _downloadedItems.TryRemove(itemId, out _);
            Console.Error.WriteLine($"[Download] Failed to download {itemId}: {ex.Message}");
            return false;
        }
    }

    private static string SanitizeFileName(string filename, Guid itemId)
    {
        var rawName = string.IsNullOrWhiteSpace(filename) ? $"{itemId}.bin" : filename;
        var safeName = Path.GetFileName(rawName);
        if (string.IsNullOrWhiteSpace(safeName))
            safeName = $"{itemId}.bin";

        var invalidChars = Path.GetInvalidFileNameChars();
        var sanitized = new string(safeName.Where(c => !invalidChars.Contains(c)).ToArray());

        return string.IsNullOrWhiteSpace(sanitized) ? $"{itemId}.bin" : sanitized;
    }

    public void ScanExistingFiles()
    {
        Console.WriteLine("[FileWatcher] Scanning existing files...");

        if (!Directory.Exists(_localFolder))
        {
            Directory.CreateDirectory(_localFolder);
            return;
        }

        var files = Directory.GetFiles(_localFolder);
        foreach (var filePath in files)
        {
            var fileName = Path.GetFileName(filePath);
            if (IsIgnoredLocalFile(fileName))
                continue;

            _knownFiles.TryAdd(fileName, 0);
        }

        Console.WriteLine($"[FileWatcher] Found {_knownFiles.Count} existing file(s).");
    }

    public void StartFileWatcher(CancellationToken ct)
    {
        Console.WriteLine("[FileWatcher] Starting file system watcher...");

        _watcher?.Dispose();
        _watcher = new FileSystemWatcher(_localFolder)
        {
            Filter = "*",
            IncludeSubdirectories = false,
            NotifyFilter = NotifyFilters.FileName | NotifyFilters.CreationTime
        };

        _watcher.Created += (sender, e) => OnFileCreated(e, ct);
        _watcher.EnableRaisingEvents = true;

        Console.WriteLine("[FileWatcher] Now watching for new files.");
    }

    private void OnFileCreated(FileSystemEventArgs e, CancellationToken ct)
    {
        var fileName = Path.GetFileName(e.FullPath);

        if (IsIgnoredLocalFile(fileName))
            return;

        // Attempt to mark as known; if already known, ignore to prevent double-upload
        if (!_knownFiles.TryAdd(fileName, 0))
        {
            Console.WriteLine($"[FileWatcher] Ignoring known file: {fileName}");
            return;
        }

        Console.WriteLine($"[FileWatcher] New file detected: {fileName}");

        // Upload on background thread to avoid blocking FileSystemWatcher
        _ = Task.Run(async () =>
        {
            try
            {
                await UploadLocalFileAsync(e.FullPath, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                Console.Error.WriteLine($"[FileWatcher] Upload failed: {ex.Message}");
            }
        }, ct);
    }

    public async Task UploadLocalFileAsync(string filePath, CancellationToken ct)
    {
        var fileName = Path.GetFileName(filePath);

        // Wait briefly to ensure file is fully written
        await Task.Delay(100, ct);

        // Retry file access in case it's locked
        for (int attempt = 0; attempt < 3; attempt++)
        {
            try
            {
                // Verify file still exists and is accessible
                if (!File.Exists(filePath))
                {
                    Console.WriteLine($"[Upload] File no longer exists: {fileName}");
                    _knownFiles.TryRemove(fileName, out _);
                    return;
                }

                var itemId = Guid.NewGuid();
                // Pre-mark to prevent echo download race (server broadcasts ItemAdded before PUT returns)
                _downloadedItems.TryAdd(itemId, fileName);
                _pendingUploads.TryAdd(itemId, 0);

                Console.WriteLine($"[Upload] Uploading {fileName} as {itemId}...");

                try
                {
                    var response = await _apiClient.UploadFileAsync(_serverUrl, _spaceId, itemId.ToString(), _jwtToken, filePath, ct);

                    // Use server-returned ID in case it differs
                    if (response.Id != itemId)
                    {
                        _downloadedItems.TryRemove(itemId, out _);
                        _downloadedItems[response.Id] = fileName;
                    }

                    Console.WriteLine($"[Upload] Successfully uploaded {fileName} as {response.Id}");
                    _pendingUploads.TryRemove(itemId, out _);
                    _pendingUploads.TryRemove(response.Id, out _);
                    return;
                }
                catch
                {
                    _pendingUploads.TryRemove(itemId, out _);
                    _downloadedItems.TryRemove(itemId, out _);
                    throw;
                }
            }
            catch (IOException) when (attempt < 2)
            {
                // File might be locked, retry
                await Task.Delay(200, ct);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[Upload] Failed to upload {fileName}: {ex.Message}");
                // Remove from known files to allow retry
                _knownFiles.TryRemove(fileName, out _);
                throw;
            }
        }

        Console.Error.WriteLine($"[Upload] Failed to access {fileName} after 3 attempts.");
        _knownFiles.TryRemove(fileName, out _);
    }

    private async Task ApplyRemoteChangesAsync(JournalResponse journal, bool forceFullSync, CancellationToken ct)
    {
        if (forceFullSync || journal.FullSyncRequired)
        {
            Console.WriteLine(forceFullSync
                ? "[Sync] Local sync state missing; performing full reconciliation."
                : "[Sync] Journal history was pruned; performing full reconciliation.");

            await PerformFullSyncAsync(journal.Checkpoint, ct);
            return;
        }

        var deletedCount = journal.Deleted.Length;
        var addedOrUpdatedFiles = journal.AddedOrUpdated.Where(item => item.ContentType == "file").ToList();
        Console.WriteLine($"[Journal] Applying {addedOrUpdatedFiles.Count} added/updated file(s) and {deletedCount} deletion(s).");
        var applySucceeded = true;

        foreach (var deletedItem in journal.Deleted.DistinctBy(d => d.Id))
        {
            if (_pendingUploads.ContainsKey(deletedItem.Id))
                continue;

            applySucceeded &= DeleteLocalItem(deletedItem.Id, deletedItem.Content);
        }

        foreach (var item in addedOrUpdatedFiles)
        {
            ct.ThrowIfCancellationRequested();
            applySucceeded &= await DownloadAndSaveFileAsync(item.Id, item.Content, item.FileSize, item.SharedAt, ct);
        }

        if (!applySucceeded)
        {
            Console.Error.WriteLine("[Journal] Some remote changes could not be applied; checkpoint was not acknowledged.");
            return;
        }

        await AcknowledgeCheckpointAsync(journal.Checkpoint, ct);
    }

    private async Task PerformFullSyncAsync(DateTimeOffset checkpoint, CancellationToken ct)
    {
        var items = await _apiClient.ListItemsAsync(_serverUrl, _spaceId, _jwtToken, ct);
        var fileItems = items.Where(i => i.ContentType == "file").ToList();
        var serverFileIds = new HashSet<Guid>(fileItems.Select(i => i.Id));
        var expectedFileNames = new HashSet<string>(
            fileItems.Select(item => SanitizeFileName(item.Content, item.Id)),
            StringComparer.OrdinalIgnoreCase);

        Console.WriteLine($"[Sync] Found {fileItems.Count} authoritative file(s) on server.");

        foreach (var localId in _downloadedItems.Keys.ToList())
        {
            if (_pendingUploads.ContainsKey(localId))
                continue;

            if (!serverFileIds.Contains(localId))
            {
                if (!OnItemDeleted(new ItemDeletedEvent(localId, _spaceGuid)))
                {
                    Console.Error.WriteLine("[Sync] Full reconciliation did not finish cleanly; checkpoint was not acknowledged.");
                    return;
                }
            }
        }

        if (!CleanupAdditionalLocalFiles(expectedFileNames))
        {
            Console.Error.WriteLine("[Sync] Full reconciliation did not finish cleanly; checkpoint was not acknowledged.");
            return;
        }

        foreach (var item in fileItems)
        {
            ct.ThrowIfCancellationRequested();
            var applied = await DownloadAndSaveFileAsync(item.Id, item.Content, item.FileSize, item.SharedAt, ct);
            if (!applied)
            {
                Console.Error.WriteLine("[Sync] Full reconciliation did not finish cleanly; checkpoint was not acknowledged.");
                return;
            }
        }

        await AcknowledgeCheckpointAsync(checkpoint, ct);
    }

    private async Task AcknowledgeCheckpointAsync(DateTimeOffset checkpoint, CancellationToken ct)
    {
        await _apiClient.UpdateJournalCheckpointAsync(_serverUrl, _spaceId, _jwtToken, checkpoint, ct);
    }

    private bool CleanupAdditionalLocalFiles(HashSet<string> expectedFileNames)
    {
        if (!Directory.Exists(_localFolder))
            return true;

        var cleanupSucceeded = true;

        foreach (var filePath in Directory.GetFiles(_localFolder))
        {
            var fileName = Path.GetFileName(filePath);
            if (IsIgnoredLocalFile(fileName) || expectedFileNames.Contains(fileName))
                continue;

            try
            {
                File.Delete(filePath);
                Console.WriteLine($"[Cleanup] Deleted stale local file: {fileName}");
                _knownFiles.TryRemove(fileName, out _);
                RemoveTrackedEntriesForFile(fileName);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[Cleanup] Failed to delete {fileName}: {ex.Message}");
                cleanupSucceeded = false;
            }
        }

        return cleanupSucceeded;
    }

    private void RemoveTrackedEntriesForFile(string fileName)
    {
        foreach (var entry in _downloadedItems
                     .Where(entry => string.Equals(entry.Value, fileName, StringComparison.OrdinalIgnoreCase))
                     .ToList())
        {
            _downloadedItems.TryRemove(entry.Key, out _);
        }
    }

    private static bool IsIgnoredLocalFile(string fileName)
    {
        return fileName.StartsWith(".") && fileName.EndsWith(".tmp", StringComparison.OrdinalIgnoreCase);
    }

    public async ValueTask DisposeAsync()
    {
        _watcher?.Dispose();
        StopPolling();
        if (_pollingTask != null)
        {
            try { await _pollingTask.ConfigureAwait(false); } catch (OperationCanceledException) { }
        }
        if (_hubConnection != null)
        {
            await _hubConnection.DisposeAsync().ConfigureAwait(false);
        }
    }
}

public sealed record ItemAddedEvent(
    Guid Id,
    Guid SpaceId,
    Guid MemberId,
    string DisplayName,
    string ContentType,
    string Content,
    long FileSize,
    DateTime SharedAt);

public sealed record ItemDeletedEvent(
    Guid Id,
    Guid SpaceId);
