using SharedSpaces.Cli.Commands;

namespace SharedSpaces.Cli.Tests;

public class LeaveCommandTests
{
    private const string SpaceId = "550e8400-e29b-41d4-a716-446655440000";

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
}
