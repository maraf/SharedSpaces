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
}

public class MockHttpMessageHandler : HttpMessageHandler
{
    private readonly Dictionary<string, (HttpStatusCode status, byte[] content, int delayMs)> _responses = new();
    private readonly List<string> _requestUrls = [];

    public void AddResponse(string url, HttpStatusCode status, string content, int delayMs = 0)
    {
        _responses[url] = (status, Encoding.UTF8.GetBytes(content), delayMs);
    }

    public void AddResponse(string url, HttpStatusCode status, byte[] content, int delayMs = 0)
    {
        _responses[url] = (status, content, delayMs);
    }

    public List<string> GetRequestUrls() => _requestUrls;

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        var url = request.RequestUri?.ToString() ?? string.Empty;
        _requestUrls.Add(url);

        if (!_responses.TryGetValue(url, out var response))
        {
            return new HttpResponseMessage(HttpStatusCode.NotFound)
            {
                Content = new StringContent($"Mock not configured for: {url}")
            };
        }

        if (response.delayMs > 0)
        {
            await Task.Delay(response.delayMs, cancellationToken);
        }

        return new HttpResponseMessage(response.status)
        {
            Content = new ByteArrayContent(response.content)
        };
    }
}
