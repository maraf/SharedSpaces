using System.CommandLine;
using System.Text.Json;
using SharedSpaces.Cli.Core.Models;
using SharedSpaces.Cli.Core.Services;

namespace SharedSpaces.Cli.Commands;

public static class SendCommand
{
    public static Command Create()
    {
        var messageArg = new Argument<string?>("message")
        {
            Description = "Text to send. Omit or pass '-' to read from stdin.",
            Arity = ArgumentArity.ZeroOrOne
        };
        var spaceIdOption = new Option<string>("--space-id") { Description = "ID of the space to send to", Required = true };
        var ttlSecondsOption = new Option<int?>("--ttl") { Description = "Optional item TTL in seconds" };
        var jsonOption = new Option<bool>("--json") { Description = "Output as JSON" };

        var command = new Command("send", "Send a text message to a space");
        command.Add(messageArg);
        command.Add(spaceIdOption);
        command.Add(ttlSecondsOption);
        command.Add(jsonOption);

        command.SetAction(async (parseResult, ct) =>
        {
            var message = parseResult.GetValue(messageArg);
            var spaceId = parseResult.GetRequiredValue(spaceIdOption);
            var ttlSeconds = parseResult.GetValue(ttlSecondsOption);
            var json = parseResult.GetValue(jsonOption);
            await HandleAsync(message, spaceId, ttlSeconds, json, ct);
        });

        return command;
    }

    private static async Task HandleAsync(string? message, string spaceId, int? ttlSeconds, bool json, CancellationToken ct)
    {
        if (ttlSeconds is <= 0)
        {
            Console.Error.WriteLine("Error: --ttl must be greater than 0.");
            Environment.ExitCode = 1;
            return;
        }

        if (message is null or "-")
        {
            message = await Console.In.ReadToEndAsync(ct);
        }

        if (string.IsNullOrWhiteSpace(message))
        {
            Console.Error.WriteLine("Error: message must not be empty.");
            Environment.ExitCode = 1;
            return;
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

        var itemId = Guid.NewGuid().ToString();

        using var api = new SharedSpacesApiClient();

        try
        {
            var response = await api.SendTextAsync(
                space.ServerUrl,
                space.SpaceId,
                itemId,
                space.JwtToken,
                message,
                ct,
                ttlSeconds);

            if (json)
            {
                Console.WriteLine(JsonSerializer.Serialize(
                    new
                    {
                        id = response.Id,
                        spaceId = response.SpaceId,
                        sharedAt = response.SharedAt,
                        ttlSeconds = response.TtlSeconds
                    },
                    new JsonSerializerOptions { WriteIndented = true }));
            }
            else
            {
                Console.WriteLine($"Sent message to space {spaceId}.");
                Console.WriteLine($"Item ID: {response.Id}");
            }
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
        catch (JsonException ex)
        {
            Console.Error.WriteLine($"Error: Failed to parse server response — {ex.Message}");
            Environment.ExitCode = 1;
        }
    }
}
