namespace SharedSpaces.Cli.Tests;

/// <summary>
/// Regression tests for issue #225 — every error path must exit with a non-zero code.
/// Only pure-validation paths are covered here: commands construct <c>ConfigService</c>
/// against the real user profile, so config- and network-dependent paths are out of scope.
/// </summary>
[Collection(CliCollection.Name)]
public class ExitCodeTests
{
    [Fact]
    public async Task Join_WithInvalidInvitation_ReturnsOne()
    {
        var result = await CliRunner.RunAsync(["join", "garbage"]);

        result.ExitCode.Should().Be(1);
        result.StdErr.Should().Contain("Invalid invite URL");
    }

    [Fact]
    public async Task Join_WithoutPin_ReturnsOne()
    {
        var result = await CliRunner.RunAsync(
            ["join", "https://example.com|11111111-1111-1111-1111-111111111111"]);

        result.ExitCode.Should().Be(1);
        result.StdErr.Should().Contain("No PIN provided");
    }

    [Fact]
    public async Task Send_WithNonPositiveTtl_ReturnsOne()
    {
        var result = await CliRunner.RunAsync(
            ["send", "hello", "--space-id", "some-space", "--ttl", "0"]);

        result.ExitCode.Should().Be(1);
        result.StdErr.Should().Contain("--ttl must be greater than 0");
    }

    [Fact]
    public async Task Send_WithEmptyMessage_ReturnsOne()
    {
        var result = await CliRunner.RunAsync(["send", "", "--space-id", "some-space"]);

        result.ExitCode.Should().Be(1);
        result.StdErr.Should().Contain("message must not be empty");
    }

    [Fact]
    public async Task Send_WithWhitespaceStdin_ReturnsOne()
    {
        var result = await CliRunner.RunAsync(["send", "-", "--space-id", "some-space"], stdin: "   \n");

        result.ExitCode.Should().Be(1);
        result.StdErr.Should().Contain("message must not be empty");
    }

    [Fact]
    public async Task Upload_WithNonPositiveTtl_ReturnsOne()
    {
        var file = Path.Combine(Path.GetTempPath(), $"sharedspaces-cli-test-{Guid.NewGuid():N}.txt");
        await File.WriteAllTextAsync(file, "content");

        try
        {
            var result = await CliRunner.RunAsync(
                ["upload", file, "--space-id", "some-space", "--ttl", "0"]);

            result.ExitCode.Should().Be(1);
            result.StdErr.Should().Contain("must be greater than 0");
        }
        finally
        {
            File.Delete(file);
        }
    }

    [Fact]
    public async Task Upload_WithMissingFile_ReturnsNonZero()
    {
        var missing = Path.Combine(Path.GetTempPath(), $"sharedspaces-cli-missing-{Guid.NewGuid():N}.txt");

        var result = await CliRunner.RunAsync(["upload", missing, "--space-id", "some-space"]);

        result.ExitCode.Should().NotBe(0);
    }

    [Fact]
    public async Task Sync_WithIntervalWithoutPassive_ReturnsOne()
    {
        var result = await CliRunner.RunAsync(
            ["sync", "--space-id", "some-space", "--folder", Path.GetTempPath(), "--interval", "30"]);

        result.ExitCode.Should().Be(1);
        result.StdErr.Should().Contain("--interval can only be used together with --passive");
    }

    [Fact]
    public async Task Sync_WithTooSmallInterval_ReturnsOne()
    {
        var result = await CliRunner.RunAsync(
            ["sync", "--space-id", "some-space", "--folder", Path.GetTempPath(), "--passive", "--interval", "1"]);

        result.ExitCode.Should().Be(1);
        result.StdErr.Should().Contain("--interval must be at least 5 seconds");
    }

    [Fact]
    public async Task UnknownCommand_ReturnsNonZero()
    {
        var result = await CliRunner.RunAsync(["definitely-not-a-command"]);

        result.ExitCode.Should().NotBe(0);
    }

    [Fact]
    public async Task MissingRequiredOption_ReturnsNonZero()
    {
        var result = await CliRunner.RunAsync(["items"]);

        result.ExitCode.Should().NotBe(0);
    }

    [Fact]
    public async Task Help_ReturnsZero()
    {
        var result = await CliRunner.RunAsync(["--help"]);

        result.ExitCode.Should().Be(0);
    }

    [Fact]
    public async Task Version_ReturnsZero()
    {
        var result = await CliRunner.RunAsync(["--version"]);

        result.ExitCode.Should().Be(0);
    }
}
