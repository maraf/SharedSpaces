using System.Collections.Concurrent;
using System.Net;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using SharedSpaces.Cli.Core.Services;

namespace SharedSpaces.Cli.Core.Tests;

public class SyncServiceTests : IDisposable
{
    private readonly string _tempDir;
    private readonly MockHttpMessageHandler _mockHttp;
    private readonly HttpClient _httpClient;

    public SyncServiceTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), $"sharedspaces-sync-test-{Guid.NewGuid():N}");
        Directory.CreateDirectory(_tempDir);
        _mockHttp = new MockHttpMessageHandler();
        _httpClient = new HttpClient(_mockHttp);
    }

    public void Dispose()
    {
        _httpClient.Dispose();
        if (Directory.Exists(_tempDir))
            Directory.Delete(_tempDir, recursive: true);
    }

    [Fact]
    public async Task InitialSync_DownloadsFileItemsOnly()
    {
        var spaceId = Guid.NewGuid();
        var serverUrl = "https://server.example.com";
        var jwt = "fake-jwt-token";

        var fileItem = new SpaceItemResponse(
            Id: Guid.NewGuid(),
            SpaceId: spaceId,
            MemberId: Guid.NewGuid(),
            ContentType: "file",
            Content: "document.pdf",
            FileSize: 1024,
            SharedAt: DateTime.UtcNow);

        var textItem = new SpaceItemResponse(
            Id: Guid.NewGuid(),
            SpaceId: spaceId,
            MemberId: Guid.NewGuid(),
            ContentType: "text",
            Content: "Hello world",
            FileSize: 0,
            SharedAt: DateTime.UtcNow);

        _mockHttp.AddResponse($"{serverUrl}/v1/spaces/{spaceId}/items",
            HttpStatusCode.OK,
            JsonSerializer.Serialize(new[] { fileItem, textItem }));

        _mockHttp.AddResponse($"{serverUrl}/v1/spaces/{spaceId}/items/{fileItem.Id}/download",
            HttpStatusCode.OK,
            Encoding.UTF8.GetBytes("fake-file-content"));

        using var apiClient = new SharedSpacesApiClient(_httpClient);
        var service = new SyncService(apiClient, serverUrl, spaceId.ToString(), jwt, _tempDir);
        await service.InitialSyncAsync(CancellationToken.None);

        File.Exists(Path.Combine(_tempDir, "document.pdf")).Should().BeTrue("file item should be downloaded");

        var requests = _mockHttp.GetRequestUrls();
        requests.Should().Contain(r => r.Contains($"/items/{fileItem.Id}/download"),
            "file item should be fetched");
        requests.Should().NotContain(r => r.Contains($"/items/{textItem.Id}"),
            "text item should be skipped");
    }

    [Fact]
    public async Task InitialSync_SkipsAlreadyDownloadedItems()
    {
        var spaceId = Guid.NewGuid();
        var serverUrl = "https://server.example.com";
        var jwt = "fake-jwt-token";
        var itemId = Guid.NewGuid();

        var fileItem = new SpaceItemResponse(
            Id: itemId,
            SpaceId: spaceId,
            MemberId: Guid.NewGuid(),
            ContentType: "file",
            Content: "existing.txt",
            FileSize: 500,
            SharedAt: DateTime.UtcNow);

        _mockHttp.AddResponse($"{serverUrl}/v1/spaces/{spaceId}/items",
            HttpStatusCode.OK,
            JsonSerializer.Serialize(new[] { fileItem }));

        using var apiClient = new SharedSpacesApiClient(_httpClient);
        var service = new SyncService(apiClient, serverUrl, spaceId.ToString(), jwt, _tempDir);

        // Pre-populate manifest
        service.MarkAsDownloaded(itemId);

        await service.InitialSyncAsync(CancellationToken.None);

        var requests = _mockHttp.GetRequestUrls();
        requests.Should().NotContain(r => r.Contains($"/items/{itemId}/download"),
            "already-downloaded item should be skipped");
    }

    [Fact]
    public async Task InitialSync_TracksDownloadedItemsInManifest()
    {
        var spaceId = Guid.NewGuid();
        var serverUrl = "https://server.example.com";
        var jwt = "fake-jwt-token";
        var itemId = Guid.NewGuid();

        var fileItem = new SpaceItemResponse(
            Id: itemId,
            SpaceId: spaceId,
            MemberId: Guid.NewGuid(),
            ContentType: "file",
            Content: "report.csv",
            FileSize: 2048,
            SharedAt: DateTime.UtcNow);

        _mockHttp.AddResponse($"{serverUrl}/v1/spaces/{spaceId}/items",
            HttpStatusCode.OK,
            JsonSerializer.Serialize(new[] { fileItem }));

        _mockHttp.AddResponse($"{serverUrl}/v1/spaces/{spaceId}/items/{itemId}/download",
            HttpStatusCode.OK,
            Encoding.UTF8.GetBytes("csv-data"));

        using var apiClient = new SharedSpacesApiClient(_httpClient);
        var service = new SyncService(apiClient, serverUrl, spaceId.ToString(), jwt, _tempDir);
        await service.InitialSyncAsync(CancellationToken.None);

        service.IsDownloaded(itemId).Should().BeTrue("downloaded item should be tracked in manifest");
    }

    [Fact]
    public async Task InitialSync_UsesContentFieldAsFilename()
    {
        var spaceId = Guid.NewGuid();
        var serverUrl = "https://server.example.com";
        var jwt = "fake-jwt-token";
        var itemId = Guid.NewGuid();

        var fileItem = new SpaceItemResponse(
            Id: itemId,
            SpaceId: spaceId,
            MemberId: Guid.NewGuid(),
            ContentType: "file",
            Content: "photo.jpg",
            FileSize: 4096,
            SharedAt: DateTime.UtcNow);

        _mockHttp.AddResponse($"{serverUrl}/v1/spaces/{spaceId}/items",
            HttpStatusCode.OK,
            JsonSerializer.Serialize(new[] { fileItem }));

        _mockHttp.AddResponse($"{serverUrl}/v1/spaces/{spaceId}/items/{itemId}/download",
            HttpStatusCode.OK,
            Encoding.UTF8.GetBytes("jpeg-binary-data"));

        using var apiClient = new SharedSpacesApiClient(_httpClient);
        var service = new SyncService(apiClient, serverUrl, spaceId.ToString(), jwt, _tempDir);
        await service.InitialSyncAsync(CancellationToken.None);

        File.Exists(Path.Combine(_tempDir, "photo.jpg")).Should().BeTrue(
            "file should use Content field as filename");
    }

    [Fact]
    public async Task InitialSync_FallsBackToItemIdWhenContentEmpty()
    {
        var spaceId = Guid.NewGuid();
        var serverUrl = "https://server.example.com";
        var jwt = "fake-jwt-token";
        var itemId = Guid.NewGuid();

        var fileItem = new SpaceItemResponse(
            Id: itemId,
            SpaceId: spaceId,
            MemberId: Guid.NewGuid(),
            ContentType: "file",
            Content: "",
            FileSize: 512,
            SharedAt: DateTime.UtcNow);

        _mockHttp.AddResponse($"{serverUrl}/v1/spaces/{spaceId}/items",
            HttpStatusCode.OK,
            JsonSerializer.Serialize(new[] { fileItem }));

        _mockHttp.AddResponse($"{serverUrl}/v1/spaces/{spaceId}/items/{itemId}/download",
            HttpStatusCode.OK,
            Encoding.UTF8.GetBytes("binary-data"));

        using var apiClient = new SharedSpacesApiClient(_httpClient);
        var service = new SyncService(apiClient, serverUrl, spaceId.ToString(), jwt, _tempDir);
        await service.InitialSyncAsync(CancellationToken.None);

        File.Exists(Path.Combine(_tempDir, $"{itemId}.bin")).Should().BeTrue(
            "file should fallback to itemId.bin when Content is empty");
    }

    [Fact]
    public async Task OnItemAdded_DownloadsNewFileItem()
    {
        var spaceId = Guid.NewGuid();
        var serverUrl = "https://server.example.com";
        var jwt = "fake-jwt-token";
        var itemId = Guid.NewGuid();

        _mockHttp.AddResponse($"{serverUrl}/v1/spaces/{spaceId}/items/{itemId}/download",
            HttpStatusCode.OK,
            Encoding.UTF8.GetBytes("new-file-content"));

        using var apiClient = new SharedSpacesApiClient(_httpClient);
        var service = new SyncService(apiClient, serverUrl, spaceId.ToString(), jwt, _tempDir);

        var addedEvent = new ItemAddedEvent(
            Id: itemId,
            SpaceId: spaceId,
            MemberId: Guid.NewGuid(),
            DisplayName: "Alice",
            ContentType: "file",
            Content: "newfile.txt",
            FileSize: 256,
            SharedAt: DateTime.UtcNow);

        await service.OnItemAddedAsync(addedEvent, CancellationToken.None);

        File.Exists(Path.Combine(_tempDir, "newfile.txt")).Should().BeTrue(
            "new file item should be downloaded on ItemAdded event");
        service.IsDownloaded(itemId).Should().BeTrue(
            "new item should be tracked in manifest");
    }

    [Fact]
    public async Task OnItemAdded_SkipsTextItems()
    {
        var spaceId = Guid.NewGuid();
        var serverUrl = "https://server.example.com";
        var jwt = "fake-jwt-token";

        using var apiClient = new SharedSpacesApiClient(_httpClient);
        var service = new SyncService(apiClient, serverUrl, spaceId.ToString(), jwt, _tempDir);

        var textEvent = new ItemAddedEvent(
            Id: Guid.NewGuid(),
            SpaceId: spaceId,
            MemberId: Guid.NewGuid(),
            DisplayName: "Bob",
            ContentType: "text",
            Content: "Just a message",
            FileSize: 0,
            SharedAt: DateTime.UtcNow);

        await service.OnItemAddedAsync(textEvent, CancellationToken.None);

        Directory.GetFiles(_tempDir).Should().BeEmpty(
            "text items should not trigger file downloads");
    }

    [Fact]
    public async Task InitialSync_CancellationStopsGracefully()
    {
        var spaceId = Guid.NewGuid();
        var serverUrl = "https://server.example.com";
        var jwt = "fake-jwt-token";

        var items = Enumerable.Range(0, 100).Select(i => new SpaceItemResponse(
            Id: Guid.NewGuid(),
            SpaceId: spaceId,
            MemberId: Guid.NewGuid(),
            ContentType: "file",
            Content: $"file{i}.txt",
            FileSize: 1024,
            SharedAt: DateTime.UtcNow)).ToArray();

        _mockHttp.AddResponse($"{serverUrl}/v1/spaces/{spaceId}/items",
            HttpStatusCode.OK,
            JsonSerializer.Serialize(items));

        foreach (var item in items)
        {
            _mockHttp.AddResponse($"{serverUrl}/v1/spaces/{spaceId}/items/{item.Id}/download",
                HttpStatusCode.OK,
                Encoding.UTF8.GetBytes("file-content"),
                delayMs: 50);
        }

        using var cts = new CancellationTokenSource();
        using var apiClient = new SharedSpacesApiClient(_httpClient);
        var service = new SyncService(apiClient, serverUrl, spaceId.ToString(), jwt, _tempDir);

        cts.CancelAfter(200);

        var act = () => service.InitialSyncAsync(cts.Token);
        await act.Should().ThrowAsync<OperationCanceledException>();

        var downloadedCount = Directory.GetFiles(_tempDir).Length;
        downloadedCount.Should().BeLessThan(100, "sync should stop before downloading all files");
        downloadedCount.Should().BeGreaterThan(0, "sync should download some files before cancellation");
    }

    // ===== FileSystemWatcher Upload Tests (Issue #120) =====
    // These tests verify the bidirectional sync upload functionality.

    [Fact]
    public void ScanExistingFiles_PopulatesKnownFiles()
    {
        var spaceId = Guid.NewGuid();
        var serverUrl = "https://server.example.com";
        var jwt = "fake-jwt-token";

        // Create files before creating SyncService
        var file1 = Path.Combine(_tempDir, "existing1.txt");
        var file2 = Path.Combine(_tempDir, "existing2.pdf");
        var file3 = Path.Combine(_tempDir, "CAPS.TXT");
        File.WriteAllText(file1, "content1");
        File.WriteAllText(file2, "content2");
        File.WriteAllText(file3, "content3");

        using var apiClient = new SharedSpacesApiClient(_httpClient);
        var service = new SyncService(apiClient, serverUrl, spaceId.ToString(), jwt, _tempDir);

        // Call ScanExistingFiles
        service.ScanExistingFiles();

        // Verify all files are tracked (case-insensitive)
        service.IsKnownFile("existing1.txt").Should().BeTrue("file1 should be known");
        service.IsKnownFile("existing2.pdf").Should().BeTrue("file2 should be known");
        service.IsKnownFile("CAPS.TXT").Should().BeTrue("file3 should be known");
        service.IsKnownFile("caps.txt").Should().BeTrue("filename tracking should be case-insensitive");
    }

    [Fact]
    public async Task DownloadAndSave_AddsToKnownFiles()
    {
        var spaceId = Guid.NewGuid();
        var serverUrl = "https://server.example.com";
        var jwt = "fake-jwt-token";
        var itemId = Guid.NewGuid();

        var fileItem = new SpaceItemResponse(
            Id: itemId,
            SpaceId: spaceId,
            MemberId: Guid.NewGuid(),
            ContentType: "file",
            Content: "downloaded.txt",
            FileSize: 1024,
            SharedAt: DateTime.UtcNow);

        _mockHttp.AddResponse($"{serverUrl}/v1/spaces/{spaceId}/items",
            HttpStatusCode.OK,
            JsonSerializer.Serialize(new[] { fileItem }));

        _mockHttp.AddResponse($"{serverUrl}/v1/spaces/{spaceId}/items/{itemId}/download",
            HttpStatusCode.OK,
            Encoding.UTF8.GetBytes("file-content"));

        using var apiClient = new SharedSpacesApiClient(_httpClient);
        var service = new SyncService(apiClient, serverUrl, spaceId.ToString(), jwt, _tempDir);
        await service.InitialSyncAsync(CancellationToken.None);

        // Verify filename is in _knownFiles
        service.IsKnownFile("downloaded.txt").Should().BeTrue(
            "downloaded file should be added to known files");
    }

    [Fact]
    public async Task UploadLocalFile_UploadsNewFile()
    {
        var spaceId = Guid.NewGuid();
        var serverUrl = "https://server.example.com";
        var jwt = "fake-jwt-token";

        // Create a local file
        var localFile = Path.Combine(_tempDir, "upload.txt");
        File.WriteAllText(localFile, "test content");

        // Configure mock for PUT upload endpoint (prefix match for dynamic itemId)
        var uploadResponse = new
        {
            id = Guid.NewGuid(),
            spaceId = spaceId,
            contentType = "file",
            content = "upload.txt",
            fileSize = new FileInfo(localFile).Length,
            sharedAt = DateTime.UtcNow
        };

        _mockHttp.AddResponseByPrefix(
            $"{serverUrl}/v1/spaces/{spaceId}/items/",
            HttpStatusCode.OK,
            JsonSerializer.Serialize(uploadResponse));

        using var apiClient = new SharedSpacesApiClient(_httpClient);
        var service = new SyncService(apiClient, serverUrl, spaceId.ToString(), jwt, _tempDir);

        await service.UploadLocalFileAsync(localFile, CancellationToken.None);

        // Verify PUT request was made
        var requests = _mockHttp.GetRequestUrls();
        requests.Should().Contain(r => r.Contains($"/v1/spaces/{spaceId}/items/") && r.Contains("/v1/spaces/"),
            "upload PUT request should be made");
    }

    [Fact]
    public async Task UploadLocalFile_MakesUploadRequest()
    {
        var spaceId = Guid.NewGuid();
        var serverUrl = "https://server.example.com";
        var jwt = "fake-jwt-token";

        var localFile = Path.Combine(_tempDir, "manifest-test.txt");
        File.WriteAllText(localFile, "manifest content");

        var uploadResponse = new
        {
            id = Guid.NewGuid(),
            spaceId = spaceId,
            contentType = "file",
            content = "manifest-test.txt",
            fileSize = new FileInfo(localFile).Length,
            sharedAt = DateTime.UtcNow
        };

        _mockHttp.AddResponseByPrefix(
            $"{serverUrl}/v1/spaces/{spaceId}/items/",
            HttpStatusCode.OK,
            JsonSerializer.Serialize(uploadResponse));

        using var apiClient = new SharedSpacesApiClient(_httpClient);
        var service = new SyncService(apiClient, serverUrl, spaceId.ToString(), jwt, _tempDir);

        await service.UploadLocalFileAsync(localFile, CancellationToken.None);

        // Verify upload request was made
        var requests = _mockHttp.GetRequestUrls();
        requests.Should().Contain(r => r.Contains($"/v1/spaces/{spaceId}/items/"),
            "upload request should be made");
    }

    [Fact]
    public async Task FileWatcher_AddsToKnownFilesBeforeUpload()
    {
        var spaceId = Guid.NewGuid();
        var serverUrl = "https://server.example.com";
        var jwt = "fake-jwt-token";

        var uploadResponse = new
        {
            id = Guid.NewGuid(),
            spaceId = spaceId,
            contentType = "file",
            content = "newfile.txt",
            fileSize = 12,
            sharedAt = DateTime.UtcNow
        };

        // Add delay to upload to ensure we can check _knownFiles before upload completes
        _mockHttp.AddResponseByPrefix(
            $"{serverUrl}/v1/spaces/{spaceId}/items/",
            HttpStatusCode.OK,
            JsonSerializer.Serialize(uploadResponse),
            delayMs: 500);

        using var apiClient = new SharedSpacesApiClient(_httpClient);
        await using var service = new SyncService(apiClient, serverUrl, spaceId.ToString(), jwt, _tempDir);

        using var cts = new CancellationTokenSource(5000);

        // Start file watcher
        _ = Task.Run(() => service.StartFileWatcher(cts.Token));
        await Task.Delay(200); // Let watcher initialize

        // Create a new file
        var newFile = Path.Combine(_tempDir, "newfile.txt");
        File.WriteAllText(newFile, "new content!");
        await Task.Delay(150); // Wait for watcher to detect and add to _knownFiles

        // File should be in _knownFiles immediately (before upload completes)
        service.IsKnownFile("newfile.txt").Should().BeTrue(
            "file should be added to known files before upload starts");

        await Task.Delay(1000); // Wait for upload to complete
        cts.Cancel();

        // Verify upload request was made
        var requests = _mockHttp.GetRequestUrls();
        requests.Should().Contain(r => r.Contains($"/v1/spaces/{spaceId}/items/"),
            "file should have been uploaded");
    }

    [Fact]
    public async Task UploadLocalFile_RemovesFromKnownFilesOnFailure()
    {
        var spaceId = Guid.NewGuid();
        var serverUrl = "https://server.example.com";
        var jwt = "fake-jwt-token";

        // Create file first so it can be scanned
        var localFile = Path.Combine(_tempDir, "failure-test.txt");
        File.WriteAllText(localFile, "failure content");

        using var apiClient = new SharedSpacesApiClient(_httpClient);
        var service = new SyncService(apiClient, serverUrl, spaceId.ToString(), jwt, _tempDir);

        // Scan to add file to _knownFiles
        service.ScanExistingFiles();
        service.IsKnownFile("failure-test.txt").Should().BeTrue("file should be in known files before upload");

        // Configure mock to return 500
        _mockHttp.AddResponseByPrefix(
            $"{serverUrl}/v1/spaces/{spaceId}/items/",
            HttpStatusCode.InternalServerError,
            "Server error");

        // Upload should fail and remove from _knownFiles
        try
        {
            await service.UploadLocalFileAsync(localFile, CancellationToken.None);
        }
        catch (HttpRequestException)
        {
            // Expected exception
        }

        // Verify filename is NOT in _knownFiles after failure (allowing retry)
        service.IsKnownFile("failure-test.txt").Should().BeFalse(
            "failed upload should remove file from known files to allow retry");
    }

    [Fact]
    public async Task UploadLocalFile_ThrowsExceptionOnFailure()
    {
        var spaceId = Guid.NewGuid();
        var serverUrl = "https://server.example.com";
        var jwt = "fake-jwt-token";

        var localFile = Path.Combine(_tempDir, "error-test.txt");
        File.WriteAllText(localFile, "error content");

        // Configure mock to return 500
        _mockHttp.AddResponseByPrefix(
            $"{serverUrl}/v1/spaces/{spaceId}/items/",
            HttpStatusCode.InternalServerError,
            "Server error");

        using var apiClient = new SharedSpacesApiClient(_httpClient);
        var service = new SyncService(apiClient, serverUrl, spaceId.ToString(), jwt, _tempDir);

        // Upload should throw on failure
        var act = async () => await service.UploadLocalFileAsync(localFile, CancellationToken.None);
        await act.Should().ThrowAsync<HttpRequestException>("upload failure should throw");
    }

    [Fact]
    public async Task FileWatcher_IgnoresKnownFiles()
    {
        var spaceId = Guid.NewGuid();
        var serverUrl = "https://server.example.com";
        var jwt = "fake-jwt-token";

        // Create a file before starting watcher
        var existingFile = Path.Combine(_tempDir, "existing.txt");
        File.WriteAllText(existingFile, "existing content");

        using var apiClient = new SharedSpacesApiClient(_httpClient);
        await using var service = new SyncService(apiClient, serverUrl, spaceId.ToString(), jwt, _tempDir);

        // Scan to populate _knownFiles with the existing filename
        service.ScanExistingFiles();

        // Remove the file so that recreating it will trigger a Created event for a known filename
        File.Delete(existingFile);

        using var cts = new CancellationTokenSource();

        // Start file watcher
        _ = Task.Run(() => service.StartFileWatcher(cts.Token));
        await Task.Delay(200); // Let watcher initialize

        // Recreate the file (triggers Created for a known filename)
        File.WriteAllText(existingFile, "recreated content");
        await Task.Delay(300); // Wait for watcher to process

        cts.Cancel();

        // Verify no upload request was made
        var requests = _mockHttp.GetRequestUrls();
        requests.Should().BeEmpty("known files should not trigger uploads");
    }

    [Fact]
    public async Task FileWatcher_IgnoresTempFiles()
    {
        var spaceId = Guid.NewGuid();
        var serverUrl = "https://server.example.com";
        var jwt = "fake-jwt-token";

        using var apiClient = new SharedSpacesApiClient(_httpClient);
        await using var service = new SyncService(apiClient, serverUrl, spaceId.ToString(), jwt, _tempDir);

        using var cts = new CancellationTokenSource();

        // Start file watcher
        _ = Task.Run(() => service.StartFileWatcher(cts.Token));
        await Task.Delay(200); // Let watcher initialize

        // Create temp files that match the pattern (start with . AND end with .tmp)
        var tempFile1 = Path.Combine(_tempDir, ".download1.tmp");
        var tempFile2 = Path.Combine(_tempDir, ".upload2.tmp");
        File.WriteAllText(tempFile1, "temp file 1");
        File.WriteAllText(tempFile2, "temp file 2");
        await Task.Delay(300); // Wait for watcher to process

        cts.Cancel();

        // Verify no upload requests were made
        var requests = _mockHttp.GetRequestUrls();
        requests.Should().BeEmpty("temp files (starting with . and ending with .tmp) should be ignored by watcher");
    }

    [Fact]
    public async Task FileWatcher_UploadsUnknownFiles()
    {
        var spaceId = Guid.NewGuid();
        var serverUrl = "https://server.example.com";
        var jwt = "fake-jwt-token";

        var uploadResponse = new
        {
            id = Guid.NewGuid(),
            spaceId = spaceId,
            contentType = "file",
            content = "newfile.txt",
            fileSize = 12,
            sharedAt = DateTime.UtcNow
        };

        _mockHttp.AddResponseByPrefix(
            $"{serverUrl}/v1/spaces/{spaceId}/items/",
            HttpStatusCode.OK,
            JsonSerializer.Serialize(uploadResponse));

        using var apiClient = new SharedSpacesApiClient(_httpClient);
        await using var service = new SyncService(apiClient, serverUrl, spaceId.ToString(), jwt, _tempDir);

        using var cts = new CancellationTokenSource(5000); // 5 second timeout

        // Start file watcher
        _ = Task.Run(() => service.StartFileWatcher(cts.Token));
        await Task.Delay(200); // Let watcher initialize

        // Create a new file
        var newFile = Path.Combine(_tempDir, "newfile.txt");
        File.WriteAllText(newFile, "new content!");
        await Task.Delay(1000); // Wait for watcher to process and upload

        cts.Cancel();

        // Verify upload request was made
        var requests = _mockHttp.GetRequestUrls();
        requests.Should().Contain(r => r.Contains($"/v1/spaces/{spaceId}/items/"),
            "unknown file should trigger upload");
    }
}

public class MockHttpMessageHandler : HttpMessageHandler
{
    private readonly Dictionary<string, (HttpStatusCode status, byte[] content, int delayMs)> _responses = new();
    private readonly List<(string prefix, HttpStatusCode status, byte[] content, int delayMs)> _prefixResponses = new();
    private readonly ConcurrentQueue<string> _requestUrls = new();

    public void AddResponse(string url, HttpStatusCode status, string content, int delayMs = 0)
    {
        _responses[url] = (status, Encoding.UTF8.GetBytes(content), delayMs);
    }

    public void AddResponse(string url, HttpStatusCode status, byte[] content, int delayMs = 0)
    {
        _responses[url] = (status, content, delayMs);
    }

    public void AddResponseByPrefix(string urlPrefix, HttpStatusCode status, string content, int delayMs = 0)
    {
        _prefixResponses.Add((urlPrefix, status, Encoding.UTF8.GetBytes(content), delayMs));
    }

    public void AddResponseByPrefix(string urlPrefix, HttpStatusCode status, byte[] content, int delayMs = 0)
    {
        _prefixResponses.Add((urlPrefix, status, content, delayMs));
    }

    public List<string> GetRequestUrls() => _requestUrls.ToList();

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        var url = request.RequestUri?.ToString() ?? string.Empty;
        _requestUrls.Enqueue(url);

        // Try exact match first
        if (_responses.TryGetValue(url, out var response))
        {
            if (response.delayMs > 0)
            {
                await Task.Delay(response.delayMs, cancellationToken);
            }

            return new HttpResponseMessage(response.status)
            {
                Content = new ByteArrayContent(response.content)
            };
        }

        // Try prefix match
        foreach (var (prefix, status, content, delayMs) in _prefixResponses)
        {
            if (url.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            {
                if (delayMs > 0)
                {
                    await Task.Delay(delayMs, cancellationToken);
                }

                return new HttpResponseMessage(status)
                {
                    Content = new ByteArrayContent(content)
                };
            }
        }

        return new HttpResponseMessage(HttpStatusCode.NotFound)
        {
            Content = new StringContent($"Mock not configured for: {url}")
        };
    }
}
