using System.CommandLine;
using System.Text.Json;
using SharedSpaces.Cli.Core.Models;
using SharedSpaces.Cli.Core.Services;

namespace SharedSpaces.Cli.Commands;

public static class UploadCommand
{
    public static Command Create()
    {
        var fileArg = new Argument<FileInfo>("file") { Description = "Path to the file to upload" }.AcceptExistingOnly();
        var spaceIdOption = new Option<string>("--space-id") { Description = "ID of the space to upload to", Required = true };
        var ttlSecondsOption = new Option<int?>("--ttl") { Description = "Optional item TTL in seconds" };

        var command = new Command("upload", "Upload a file to a space");
        command.Add(fileArg);
        command.Add(spaceIdOption);
        command.Add(ttlSecondsOption);

        command.SetAction(async (parseResult, ct) =>
        {
            var file = parseResult.GetRequiredValue(fileArg);
            var spaceId = parseResult.GetRequiredValue(spaceIdOption);
            var ttlSeconds = parseResult.GetValue(ttlSecondsOption);
            return await HandleAsync(file, spaceId, ttlSeconds, ct);
        });

        return command;
    }

    private static async Task<int> HandleAsync(FileInfo file, string spaceId, int? ttlSeconds, CancellationToken ct)
    {
        if (ttlSeconds is <= 0)
        {
            Console.Error.WriteLine("Error: --ttl-seconds must be greater than 0.");
            return 1;
        }

        var configService = new ConfigService();
        SpaceEntry? space;

        try
        {
            space = await configService.GetSpaceAsync(spaceId, ct);
        }
        catch (JsonException ex)
        {
            Console.Error.WriteLine($"Error: Failed to read CLI config — {ex.Message}");
            return 1;
        }

        if (space is null)
        {
            Console.Error.WriteLine($"Error: No token found for space {spaceId}.");
            Console.Error.WriteLine("Run 'sharedspaces join' first to join the space.");
            return 1;
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
                ct,
                ttlSeconds);

            Console.WriteLine($"Uploaded {file.Name} ({response.FileSize:N0} bytes).");
            Console.WriteLine($"Item ID: {response.Id}");
            return 0;
        }
        catch (HttpRequestException ex)
        {
            Console.Error.WriteLine($"Error: {ex.Message}");
            return 1;
        }
        catch (UnauthorizedAccessException ex)
        {
            Console.Error.WriteLine($"Error: Access denied — {ex.Message}");
            return 1;
        }
        catch (IOException ex)
        {
            Console.Error.WriteLine($"Error: {ex.Message}");
            return 1;
        }
        catch (JsonException ex)
        {
            Console.Error.WriteLine($"Error: Failed to parse server response — {ex.Message}");
            return 1;
        }
    }
}
