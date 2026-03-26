using System.CommandLine;
using System.Text.Json;
using SharedSpaces.Cli.Core.Services;

namespace SharedSpaces.Cli.Commands;

public static class SpacesCommand
{
    public static Command Create()
    {
        var command = new Command("spaces", "List all joined spaces");
        command.Aliases.Add("list");

        command.SetAction(async (parseResult, ct) =>
        {
            await HandleAsync(ct);
        });

        return command;
    }

    private static async Task HandleAsync(CancellationToken ct)
    {
        var configService = new ConfigService();

        try
        {
            var config = await configService.LoadAsync(ct);

            if (config.Spaces.Count == 0)
            {
                Console.WriteLine("No spaces joined. Use 'join' to connect to a space.");
                return;
            }

            const int nameWidth = -20;
            const int displayWidth = -20;
            const int serverWidth = -30;

            Console.WriteLine(
                $"{"Space Name",nameWidth}  {"Display Name",displayWidth}  {"Server",serverWidth}  Space ID");
            Console.WriteLine(
                $"{new string('-', -nameWidth)}  {new string('-', -displayWidth)}  {new string('-', -serverWidth)}  {new string('-', 36)}");

            foreach (var space in config.Spaces)
            {
                Console.WriteLine(
                    $"{space.SpaceName,nameWidth}  {space.DisplayName,displayWidth}  {space.ServerUrl,serverWidth}  {space.SpaceId}");
            }
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
