using System.CommandLine;
using System.Text.Json;
using SharedSpaces.Cli.Core.Services;

namespace SharedSpaces.Cli.Commands;

public static class UploadCommand
{
    public static Command Create()
    {
        var fileArg = new Argument<FileInfo>("file") { Description = "Path to the file to upload" }.AcceptExistingOnly();
        var spaceIdOption = new Option<string>("--space-id") { Description = "ID of the space to upload to", Required = true };

        var command = new Command("upload", "Upload a file to a space");
        command.Add(fileArg);
        command.Add(spaceIdOption);

        command.SetAction(async (parseResult, ct) =>
        {
            var file = parseResult.GetRequiredValue(fileArg);
            var spaceId = parseResult.GetRequiredValue(spaceIdOption);
            await HandleAsync(file, spaceId, ct);
        });

        return command;
    }

    private static async Task HandleAsync(FileInfo file, string spaceId, CancellationToken ct)
    {
        var configService = new ConfigService();
        var space = await configService.GetSpaceAsync(spaceId, ct);

        if (space is null)
        {
            Console.Error.WriteLine($"Error: No token found for space {spaceId}.");
            Console.Error.WriteLine("Run 'sharedspaces join' first to join the space.");
            Environment.ExitCode = 1;
            return;
        }

        var itemId = Guid.NewGuid().ToString();

        Console.WriteLine($"Uploading {file.Name} to space {spaceId}...");

        using var api = new SharedSpacesApiClient();

        try
        {
            var response = await api.UploadFileAsync(
                space.ServerUrl,
                space.SpaceId,
                itemId,
                space.JwtToken,
                file.FullName,
                ct);

            Console.WriteLine($"Uploaded {file.Name} ({response.FileSize:N0} bytes).");
            Console.WriteLine($"Item ID: {response.Id}");
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
            Console.Error.WriteLine($"Error: Failed to read CLI config — {ex.Message}");
            Environment.ExitCode = 1;
        }
    }
}
