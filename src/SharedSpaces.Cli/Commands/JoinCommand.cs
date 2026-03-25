using System.CommandLine;
using SharedSpaces.Cli.Core;
using SharedSpaces.Cli.Core.Models;
using SharedSpaces.Cli.Core.Services;

namespace SharedSpaces.Cli.Commands;

public static class JoinCommand
{
    public static Command Create()
    {
        var urlArg = new Argument<string>("url") { Description = "Invite URL or invitation string (serverUrl|spaceId|pin)" };
        var pinOption = new Option<string?>("--pin") { Description = "PIN code (overrides PIN embedded in URL)" };
        var displayNameOption = new Option<string?>("--display-name") { Description = "Display name for the space membership" };

        var command = new Command("join", "Join a space by exchanging a PIN for an access token");
        command.Add(urlArg);
        command.Add(pinOption);
        command.Add(displayNameOption);

        command.SetAction(async (parseResult, ct) =>
        {
            var url = parseResult.GetRequiredValue(urlArg);
            var pinOverride = parseResult.GetValue(pinOption);
            var displayName = parseResult.GetValue(displayNameOption);
            await HandleAsync(url, pinOverride, displayName, ct);
        });

        return command;
    }

    private static async Task HandleAsync(string url, string? pinOverride, string? displayName, CancellationToken ct)
    {
        var invitation = InvitationParser.Parse(url);
        if (invitation is null)
        {
            Console.Error.WriteLine("Error: Invalid invite URL or invitation string.");
            Console.Error.WriteLine("Expected format: serverUrl|spaceId[|pin]");
            Console.Error.WriteLine("            or: https://app.example.com/?join=serverUrl%7CspaceId%7Cpin");
            Console.Error.WriteLine("Use --pin to provide the PIN separately when not embedded in the invite.");
            Environment.ExitCode = 1;
            return;
        }

        var pin = pinOverride ?? invitation.Pin;
        if (string.IsNullOrEmpty(pin))
        {
            Console.Error.WriteLine("Error: No PIN provided. Use --pin or include it in the invite URL.");
            Environment.ExitCode = 1;
            return;
        }

        displayName ??= Environment.UserName;

        Console.WriteLine($"Joining space {invitation.SpaceId} on {invitation.ServerUrl}...");

        using var api = new SharedSpacesApiClient();
        var configService = new ConfigService();

        try
        {
            var tokenResponse = await api.ExchangeTokenAsync(
                invitation.ServerUrl, invitation.SpaceId, pin, displayName, ct);

            await configService.UpsertSpaceAsync(new SpaceEntry
            {
                JwtToken = tokenResponse.Token
            }, ct);

            Console.WriteLine($"Joined as \"{displayName}\".");
            Console.WriteLine($"Token stored in config.");
        }
        catch (HttpRequestException ex)
        {
            Console.Error.WriteLine($"Error: {ex.Message}");
            Environment.ExitCode = 1;
        }
    }
}
