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
            return await ExecuteAsync(new ConfigService(), spaceId, json, Console.Out, Console.Error, ct);
        });

        return command;
    }

    public static async Task<int> ExecuteAsync(
        ConfigService configService,
        string spaceId,
        bool json,
        TextWriter output,
        TextWriter error,
        CancellationToken ct)
    {
        try
        {
            if (!Guid.TryParse(spaceId, out _))
            {
                error.WriteLine($"Error: Space ID '{spaceId}' must be a GUID.");
                error.WriteLine("Run 'sharedspaces spaces' to list joined spaces.");
                return 1;
            }

            var space = await configService.GetSpaceAsync(spaceId, ct);
            if (space is null)
            {
                error.WriteLine($"Error: No token found for space {spaceId}.");
                error.WriteLine("Run 'sharedspaces spaces' to list joined spaces.");
                return 1;
            }

            var spaceName = space.SpaceName;
            var displayName = space.DisplayName;
            var serverUrl = space.ServerUrl;
            var serverName = space.ServerName;

            await configService.RemoveSpaceAsync(spaceId, ct);

            if (json)
            {
                var jsonOutput = new
                {
                    left = true,
                    spaceId,
                    spaceName,
                    displayName,
                    serverUrl,
                    serverName = string.IsNullOrEmpty(serverName) ? null : serverName,
                };
                output.WriteLine(JsonSerializer.Serialize(jsonOutput, new JsonSerializerOptions { WriteIndented = true }));
                return 0;
            }

            output.WriteLine(FormatLeftMessage(spaceId, spaceName, serverUrl, serverName));
            return 0;
        }
        catch (JsonException ex)
        {
            error.WriteLine($"Error: Failed to read CLI config — {ex.Message}");
            return 1;
        }
        catch (IOException ex)
        {
            error.WriteLine($"Error: {ex.Message}");
            return 1;
        }
        catch (UnauthorizedAccessException ex)
        {
            error.WriteLine($"Error: Access denied — {ex.Message}");
            return 1;
        }
    }

    /// <summary>
    /// Builds the success message shown after leaving a space. The trailing reassurance that
    /// items survive on the server is the only thing distinguishing this from a destructive
    /// operation, so it must not be dropped — see <c>LeaveCommandTests</c>.
    /// </summary>
    public static string FormatLeftMessage(string spaceId, string spaceName, string serverUrl, string serverName)
    {
        var spaceLabel = string.IsNullOrEmpty(spaceName) ? spaceId : $"\"{spaceName}\"";
        var serverLabel = !string.IsNullOrEmpty(serverName)
            ? $"{serverName} ({serverUrl})"
            : serverUrl;
        var location = string.IsNullOrEmpty(serverUrl) ? string.Empty : $" on {serverLabel}";

        return $"Left {spaceLabel}{location}. Items remain on the server.";
    }
}
