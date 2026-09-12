using System.CommandLine;
using System.Text.Json;
using SharedSpaces.Cli.Core.Services;

namespace SharedSpaces.Cli.Commands;

public static class LeaveCommand
{
    public static Command Create()
    {
        var spaceIdOption = new Option<string>("--space-id") { Description = "ID of the space to leave", Required = true };
        var jsonOption = new Option<bool>("--json") { Description = "Output as JSON" };

        var command = new Command("leave", "Leave a joined space by removing its locally stored token");
        command.Add(spaceIdOption);
        command.Add(jsonOption);

        command.SetAction(async (parseResult, ct) =>
        {
            var spaceId = parseResult.GetRequiredValue(spaceIdOption);
            var json = parseResult.GetValue(jsonOption);
            await HandleAsync(spaceId, json, ct);
        });

        return command;
    }

    private static async Task HandleAsync(string spaceId, bool json, CancellationToken ct)
    {
        var configService = new ConfigService();

        try
        {
            var space = await configService.GetSpaceAsync(spaceId, ct);
            if (space is null)
            {
                Console.Error.WriteLine($"Error: No token found for space {spaceId}.");
                Console.Error.WriteLine("Run 'sharedspaces spaces' to list joined spaces.");
                Environment.ExitCode = 1;
                return;
            }

            var spaceName = space.SpaceName;
            var displayName = space.DisplayName;
            var serverUrl = space.ServerUrl;
            var serverName = space.ServerName;

            await configService.RemoveSpaceAsync(spaceId, ct);

            if (json)
            {
                var output = new
                {
                    left = true,
                    spaceId,
                    spaceName,
                    displayName,
                    serverUrl,
                    serverName = string.IsNullOrEmpty(serverName) ? null : serverName,
                };
                Console.WriteLine(JsonSerializer.Serialize(output, new JsonSerializerOptions { WriteIndented = true }));
                return;
            }

            var spaceLabel = string.IsNullOrEmpty(spaceName) ? spaceId : $"\"{spaceName}\"";
            var serverLabel = !string.IsNullOrEmpty(serverName)
                ? $"{serverName} ({serverUrl})"
                : serverUrl;
            var location = string.IsNullOrEmpty(serverUrl) ? string.Empty : $" on {serverLabel}";

            Console.WriteLine($"Left {spaceLabel}{location}. Items remain on the server.");
        }
        catch (JsonException ex)
        {
            Console.Error.WriteLine($"Error: Failed to read CLI config — {ex.Message}");
            Environment.ExitCode = 1;
        }
        catch (IOException ex)
        {
            Console.Error.WriteLine($"Error: {ex.Message}");
            Environment.ExitCode = 1;
        }
        catch (UnauthorizedAccessException ex)
        {
            Console.Error.WriteLine($"Error: Access denied — {ex.Message}");
            Environment.ExitCode = 1;
        }
    }
}
