using System.CommandLine;
using System.Text.Json;
using SharedSpaces.Cli.Core.Models;
using SharedSpaces.Cli.Core.Services;

namespace SharedSpaces.Cli.Commands;

public static class SyncCommand
{
    public static Command Create()
    {
        var spaceIdOption = new Option<string>("--space-id") { Description = "ID of the space to sync from", Required = true };
        var folderOption = new Option<string>("--folder") { Description = "Path to local folder for synced files", Required = true };

        var command = new Command("sync", "Sync files from a space to a local folder");
        command.Add(spaceIdOption);
        command.Add(folderOption);

        command.SetAction(async (parseResult, ct) =>
        {
            var spaceId = parseResult.GetRequiredValue(spaceIdOption);
            var folder = parseResult.GetRequiredValue(folderOption);
            await HandleAsync(spaceId, folder, ct);
        });

        return command;
    }

    private static async Task HandleAsync(string spaceId, string folder, CancellationToken ct)
    {
        var configService = new ConfigService();
        SpaceEntry? space;

        try
        {
            space = await configService.GetSpaceAsync(spaceId, ct);
        }
        catch (JsonException ex)
        {
            Console.Error.WriteLine($"Error: Failed to read CLI config — {ex.Message}");
            Environment.ExitCode = 1;
            return;
        }

        if (space is null)
        {
            Console.Error.WriteLine($"Error: No token found for space {spaceId}.");
            Console.Error.WriteLine("Run 'sharedspaces join' first to join the space.");
            Environment.ExitCode = 1;
            return;
        }

        // Validate and create folder
        try
        {
            if (!Directory.Exists(folder))
            {
                Directory.CreateDirectory(folder);
                Console.WriteLine($"Created directory: {folder}");
            }
        }
        catch (IOException ex)
        {
            Console.Error.WriteLine($"Error: Failed to create directory — {ex.Message}");
            Environment.ExitCode = 1;
            return;
        }
        catch (UnauthorizedAccessException ex)
        {
            Console.Error.WriteLine($"Error: Access denied — {ex.Message}");
            Environment.ExitCode = 1;
            return;
        }

        // Create and run sync service
        using var apiClient = new SharedSpacesApiClient();
        using var syncService = new SyncService(
            apiClient,
            space.ServerUrl,
            space.SpaceId,
            space.JwtToken,
            folder);

        try
        {
            await syncService.RunAsync(ct);
        }
        catch (HttpRequestException ex)
        {
            Console.Error.WriteLine($"Error: {ex.Message}");
            Environment.ExitCode = 1;
        }
        catch (UnauthorizedAccessException ex)
        {
            Console.Error.WriteLine($"Error: Access denied — {ex.Message}");
            Environment.ExitCode = 1;
        }
        catch (IOException ex)
        {
            Console.Error.WriteLine($"Error: {ex.Message}");
            Environment.ExitCode = 1;
        }
        catch (JsonException ex)
        {
            Console.Error.WriteLine($"Error: Failed to parse server response — {ex.Message}");
            Environment.ExitCode = 1;
        }
        catch (OperationCanceledException)
        {
            // Normal cancellation via Ctrl+C
            Console.WriteLine("\nSync stopped by user.");
        }
    }
}
