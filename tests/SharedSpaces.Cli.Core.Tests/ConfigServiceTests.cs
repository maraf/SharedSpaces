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

    [Fact]
    public async Task LoadAsync_NoFile_ReturnsEmptyConfig()
    {
        var config = await _service.LoadAsync();

        config.Spaces.Should().BeEmpty();
    }

    [Fact]
    public async Task SaveAsync_CreatesDirectoryAndFile()
    {
        var config = new CliConfig
        {
            Spaces = [new SpaceEntry
            {
                SpaceId = "550e8400-e29b-41d4-a716-446655440000",
                ServerUrl = "https://server.example.com",
                JwtToken = "eyJ...",
                DisplayName = "TestUser",
                JoinedAt = new DateTime(2025, 1, 15, 10, 30, 0, DateTimeKind.Utc)
            }]
        };

        await _service.SaveAsync(config);

        File.Exists(Path.Combine(_tempDir, "config.json")).Should().BeTrue();
    }

    [Fact]
    public async Task SaveAndLoad_RoundTrips()
    {
        var entry = new SpaceEntry
        {
            SpaceId = "550e8400-e29b-41d4-a716-446655440000",
            ServerUrl = "https://server.example.com",
            JwtToken = "eyJ...",
            DisplayName = "TestUser",
            JoinedAt = new DateTime(2025, 1, 15, 10, 30, 0, DateTimeKind.Utc)
        };

        await _service.UpsertSpaceAsync(entry);
        var loaded = await _service.GetSpaceAsync("550e8400-e29b-41d4-a716-446655440000");

        loaded.Should().NotBeNull();
        loaded!.ServerUrl.Should().Be("https://server.example.com");
        loaded.JwtToken.Should().Be("eyJ...");
        loaded.DisplayName.Should().Be("TestUser");
    }

    [Fact]
    public async Task UpsertSpaceAsync_ReplacesExistingEntry()
    {
        var original = new SpaceEntry
        {
            SpaceId = "550e8400-e29b-41d4-a716-446655440000",
            ServerUrl = "https://old.example.com",
            JwtToken = "old-token",
            DisplayName = "OldName",
            JoinedAt = DateTime.UtcNow.AddDays(-1)
        };
        await _service.UpsertSpaceAsync(original);

        var updated = new SpaceEntry
        {
            SpaceId = "550e8400-e29b-41d4-a716-446655440000",
            ServerUrl = "https://new.example.com",
            JwtToken = "new-token",
            DisplayName = "NewName",
            JoinedAt = DateTime.UtcNow
        };
        await _service.UpsertSpaceAsync(updated);

        var config = await _service.LoadAsync();
        config.Spaces.Should().HaveCount(1);
        config.Spaces[0].JwtToken.Should().Be("new-token");
    }

    [Fact]
    public async Task GetSpaceAsync_CaseInsensitiveMatch()
    {
        await _service.UpsertSpaceAsync(new SpaceEntry
        {
            SpaceId = "550e8400-e29b-41d4-a716-446655440000",
            ServerUrl = "https://server.example.com",
            JwtToken = "token",
            DisplayName = "User",
            JoinedAt = DateTime.UtcNow
        });

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
    public async Task SaveAsync_UsesCamelCaseInJsonKeys()
    {
        await _service.UpsertSpaceAsync(new SpaceEntry
        {
            SpaceId = "550e8400-e29b-41d4-a716-446655440000",
            ServerUrl = "https://server.example.com",
            JwtToken = "token",
            DisplayName = "User",
            JoinedAt = DateTime.UtcNow
        });

        var json = await File.ReadAllTextAsync(Path.Combine(_tempDir, "config.json"));
        json.Should().Contain("\"spaceId\"");
        json.Should().Contain("\"serverUrl\"");
        json.Should().Contain("\"jwtToken\"");
        json.Should().Contain("\"displayName\"");
        json.Should().Contain("\"joinedAt\"");
    }
}
