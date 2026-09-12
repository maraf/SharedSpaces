using System.Text;
using System.Text.Json;
using SharedSpaces.Cli.Commands;
using SharedSpaces.Cli.Core.Models;
using SharedSpaces.Cli.Core.Services;

namespace SharedSpaces.Cli.Tests;

public class LeaveCommandTests : IDisposable
{
    private const string SpaceId = "550e8400-e29b-41d4-a716-446655440000";
    private readonly string _tempDir;
    private readonly ConfigService _service;

    public LeaveCommandTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), $"sharedspaces-test-{Guid.NewGuid():N}");
        _service = new ConfigService(_tempDir);
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDir))
            Directory.Delete(_tempDir, recursive: true);
    }

    // `leave` has no confirmation prompt, so this message is the only thing telling the user
    // their items survive on the server. Without it the command reads as destructive.
    [Fact]
    public void FormatLeftMessage_ReassuresThatItemsRemainOnServer()
    {
        var message = LeaveCommand.FormatLeftMessage(
            SpaceId, "Notifications", "https://server.example.com", "Example");

        message.Should().EndWith("Items remain on the server.");
    }

    [Fact]
    public void FormatLeftMessage_IncludesSpaceNameAndServerName()
    {
        var message = LeaveCommand.FormatLeftMessage(
            SpaceId, "Notifications", "https://server.example.com", "Example");

        message.Should().Be(
            "Left \"Notifications\" on Example (https://server.example.com). Items remain on the server.");
    }

    [Fact]
    public void FormatLeftMessage_WithoutServerName_UsesServerUrlOnly()
    {
        var message = LeaveCommand.FormatLeftMessage(
            SpaceId, "Notifications", "https://server.example.com", "");

        message.Should().Be(
            "Left \"Notifications\" on https://server.example.com. Items remain on the server.");
    }

    [Fact]
    public void FormatLeftMessage_WithoutSpaceName_FallsBackToSpaceId()
    {
        var message = LeaveCommand.FormatLeftMessage(
            SpaceId, "", "https://server.example.com", "");

        message.Should().Be(
            $"Left {SpaceId} on https://server.example.com. Items remain on the server.");
    }

    // A token missing both claims still produces a sentence, not "Left  on . ...".
    [Fact]
    public void FormatLeftMessage_WithoutServerUrl_OmitsLocation()
    {
        var message = LeaveCommand.FormatLeftMessage(SpaceId, "", "", "");

        message.Should().Be($"Left {SpaceId}. Items remain on the server.");
    }

    [Fact]
    public async Task ExecuteAsync_RemovesSpaceAndWritesSuccessMessage()
    {
        var jwt = CreateTestJwt(SpaceId, "https://server.example.com", "Alice", "Notifications", "Example");
        await _service.UpsertSpaceAsync(new SpaceEntry { JwtToken = jwt });
        var output = new StringWriter();
        var error = new StringWriter();

        var exitCode = await LeaveCommand.ExecuteAsync(_service, SpaceId, json: false, output, error, CancellationToken.None);

        exitCode.Should().Be(0);
        output.ToString().Should().Be(
            $"Left \"Notifications\" on Example (https://server.example.com). Items remain on the server.{Environment.NewLine}");
        error.ToString().Should().BeEmpty();
        (await _service.LoadAsync()).Spaces.Should().BeEmpty();
    }

    [Fact]
    public async Task ExecuteAsync_WithJson_RemovesSpaceAndWritesJson()
    {
        var jwt = CreateTestJwt(SpaceId, "https://server.example.com", "Alice", "Notifications", "Example");
        await _service.UpsertSpaceAsync(new SpaceEntry { JwtToken = jwt });
        var output = new StringWriter();
        var error = new StringWriter();

        var exitCode = await LeaveCommand.ExecuteAsync(_service, SpaceId, json: true, output, error, CancellationToken.None);

        exitCode.Should().Be(0);
        error.ToString().Should().BeEmpty();
        using var document = JsonDocument.Parse(output.ToString());
        var root = document.RootElement;
        root.GetProperty("left").GetBoolean().Should().BeTrue();
        root.GetProperty("spaceId").GetString().Should().Be(SpaceId);
        root.GetProperty("spaceName").GetString().Should().Be("Notifications");
        root.GetProperty("displayName").GetString().Should().Be("Alice");
        root.GetProperty("serverUrl").GetString().Should().Be("https://server.example.com");
        root.GetProperty("serverName").GetString().Should().Be("Example");
        (await _service.LoadAsync()).Spaces.Should().BeEmpty();
    }

    [Fact]
    public async Task ExecuteAsync_UnknownSpaceId_ReturnsErrorAndLeavesConfigUntouched()
    {
        var jwt = CreateTestJwt(SpaceId, "https://server.example.com", "Alice", "Notifications", "Example");
        await _service.UpsertSpaceAsync(new SpaceEntry { JwtToken = jwt });
        var output = new StringWriter();
        var error = new StringWriter();

        var exitCode = await LeaveCommand.ExecuteAsync(
            _service,
            "00000000-0000-0000-0000-000000000000",
            json: false,
            output,
            error,
            CancellationToken.None);

        exitCode.Should().Be(1);
        output.ToString().Should().BeEmpty();
        error.ToString().Should().Be(
            $"Error: No token found for space 00000000-0000-0000-0000-000000000000.{Environment.NewLine}" +
            $"Run 'sharedspaces spaces' to list joined spaces.{Environment.NewLine}");
        var config = await _service.LoadAsync();
        config.Spaces.Should().ContainSingle();
        config.Spaces[0].JwtToken.Should().Be(jwt);
    }

    [Theory]
    [InlineData("")]
    [InlineData("not-a-guid")]
    public async Task ExecuteAsync_InvalidSpaceId_ReturnsErrorAndDoesNotRemoveMalformedToken(string invalidSpaceId)
    {
        await _service.SaveAsync(new CliConfig
        {
            Spaces = [new SpaceEntry { JwtToken = "not-a-jwt" }]
        });
        var output = new StringWriter();
        var error = new StringWriter();

        var exitCode = await LeaveCommand.ExecuteAsync(
            _service,
            invalidSpaceId,
            json: false,
            output,
            error,
            CancellationToken.None);

        exitCode.Should().Be(1);
        output.ToString().Should().BeEmpty();
        error.ToString().Should().Be(
            $"Error: Space ID '{invalidSpaceId}' must be a GUID.{Environment.NewLine}" +
            $"Run 'sharedspaces spaces' to list joined spaces.{Environment.NewLine}");
        var config = await _service.LoadAsync();
        config.Spaces.Should().ContainSingle();
        config.Spaces[0].JwtToken.Should().Be("not-a-jwt");
    }

    [Fact]
    public async Task ExecuteAsync_MatchesSpaceIdCaseInsensitively()
    {
        var jwt = CreateTestJwt(SpaceId, "https://server.example.com", "Alice", "Notifications", "Example");
        await _service.UpsertSpaceAsync(new SpaceEntry { JwtToken = jwt });
        var output = new StringWriter();
        var error = new StringWriter();

        var exitCode = await LeaveCommand.ExecuteAsync(
            _service,
            "550E8400-E29B-41D4-A716-446655440000",
            json: false,
            output,
            error,
            CancellationToken.None);

        exitCode.Should().Be(0);
        output.ToString().Should().Be(
            $"Left \"Notifications\" on Example (https://server.example.com). Items remain on the server.{Environment.NewLine}");
        error.ToString().Should().BeEmpty();
        (await _service.LoadAsync()).Spaces.Should().BeEmpty();
    }

    private static string CreateTestJwt(
        string spaceId,
        string serverUrl,
        string displayName,
        string spaceName = "Test Space",
        string serverName = "")
    {
        var header = Base64UrlEncode("{\"alg\":\"HS256\",\"typ\":\"JWT\"}");
        var payload = Base64UrlEncode(JsonSerializer.Serialize(new Dictionary<string, string>
        {
            ["space_id"] = spaceId,
            ["server_url"] = serverUrl,
            ["display_name"] = displayName,
            ["space_name"] = spaceName,
            ["server_name"] = serverName
        }));
        var signature = Convert.ToBase64String(new byte[32])
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
        return $"{header}.{payload}.{signature}";
    }

    private static string Base64UrlEncode(string value)
    {
        return Convert.ToBase64String(Encoding.UTF8.GetBytes(value))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }
}
