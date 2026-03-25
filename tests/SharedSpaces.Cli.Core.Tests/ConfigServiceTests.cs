using System.Text.Json;
using SharedSpaces.Cli.Core.Models;
using SharedSpaces.Cli.Core.Services;

namespace SharedSpaces.Cli.Core.Tests;

public class ConfigServiceTests : IDisposable
{
    private readonly string _tempDir;
    private readonly ConfigService _service;

    public ConfigServiceTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), $"sharedspaces-test-{Guid.NewGuid():N}");
        _service = new ConfigService(_tempDir);
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDir))
            Directory.Delete(_tempDir, recursive: true);
    }

    private static string CreateTestJwt(string spaceId, string serverUrl, string displayName, string spaceName = "Test Space")
    {
        var header = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes("{\"alg\":\"HS256\",\"typ\":\"JWT\"}"))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var payload = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(
            JsonSerializer.Serialize(new Dictionary<string, string>
            {
                ["space_id"] = spaceId,
                ["server_url"] = serverUrl,
                ["display_name"] = displayName,
                ["space_name"] = spaceName
            })))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var signature = Convert.ToBase64String(new byte[32])
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
        return $"{header}.{payload}.{signature}";
    }

    [Fact]
    public async Task LoadAsync_NoFile_ReturnsEmptyConfig()
    {
        var config = await _service.LoadAsync();

        config.Spaces.Should().BeEmpty();
    }

    [Fact]
    public async Task SaveAsync_CreatesDirectoryAndFile()
    {
        var jwt = CreateTestJwt("550e8400-e29b-41d4-a716-446655440000", "https://server.example.com", "TestUser");
        var config = new CliConfig
        {
            Spaces = [new SpaceEntry { JwtToken = jwt }]
        };

        await _service.SaveAsync(config);

        File.Exists(Path.Combine(_tempDir, "config.json")).Should().BeTrue();
    }

    [Fact]
    public async Task SaveAndLoad_RoundTrips()
    {
        var jwt = CreateTestJwt("550e8400-e29b-41d4-a716-446655440000", "https://server.example.com", "TestUser", "My Space");
        var entry = new SpaceEntry { JwtToken = jwt };

        await _service.UpsertSpaceAsync(entry);
        var loaded = await _service.GetSpaceAsync("550e8400-e29b-41d4-a716-446655440000");

        loaded.Should().NotBeNull();
        loaded!.JwtToken.Should().Be(jwt);
        loaded.ServerUrl.Should().Be("https://server.example.com");
        loaded.DisplayName.Should().Be("TestUser");
        loaded.SpaceName.Should().Be("My Space");
    }

    [Fact]
    public async Task UpsertSpaceAsync_ReplacesExistingEntry()
    {
        var oldJwt = CreateTestJwt("550e8400-e29b-41d4-a716-446655440000", "https://old.example.com", "OldName");
        await _service.UpsertSpaceAsync(new SpaceEntry { JwtToken = oldJwt });

        var newJwt = CreateTestJwt("550e8400-e29b-41d4-a716-446655440000", "https://new.example.com", "NewName");
        await _service.UpsertSpaceAsync(new SpaceEntry { JwtToken = newJwt });

        var config = await _service.LoadAsync();
        config.Spaces.Should().HaveCount(1);
        config.Spaces[0].JwtToken.Should().Be(newJwt);
        config.Spaces[0].ServerUrl.Should().Be("https://new.example.com");
    }

    [Fact]
    public async Task GetSpaceAsync_CaseInsensitiveMatch()
    {
        var jwt = CreateTestJwt("550e8400-e29b-41d4-a716-446655440000", "https://server.example.com", "User");
        await _service.UpsertSpaceAsync(new SpaceEntry { JwtToken = jwt });

        var result = await _service.GetSpaceAsync("550E8400-E29B-41D4-A716-446655440000");
        result.Should().NotBeNull();
    }

    [Fact]
    public async Task GetSpaceAsync_NotFound_ReturnsNull()
    {
        var result = await _service.GetSpaceAsync("00000000-0000-0000-0000-000000000000");
        result.Should().BeNull();
    }

    [Fact]
    public async Task SaveAsync_WritesOnlyJwtTokenToJson()
    {
        var jwt = CreateTestJwt("550e8400-e29b-41d4-a716-446655440000", "https://server.example.com", "User");
        await _service.UpsertSpaceAsync(new SpaceEntry { JwtToken = jwt });

        var json = await File.ReadAllTextAsync(Path.Combine(_tempDir, "config.json"));
        json.Should().Contain("\"jwtToken\"");
        json.Should().NotContain("\"spaceId\"");
        json.Should().NotContain("\"serverUrl\"");
        json.Should().NotContain("\"displayName\"");
        json.Should().NotContain("\"joinedAt\"");
    }

    [Fact]
    public void SpaceEntry_ExtractsClaimsFromJwt()
    {
        var jwt = CreateTestJwt(
            "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
            "https://myserver.example.com",
            "Alice",
            "Project Alpha");

        var entry = new SpaceEntry { JwtToken = jwt };

        entry.SpaceId.Should().Be("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
        entry.ServerUrl.Should().Be("https://myserver.example.com");
        entry.DisplayName.Should().Be("Alice");
        entry.SpaceName.Should().Be("Project Alpha");
    }
}
