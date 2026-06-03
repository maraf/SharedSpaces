using System.CommandLine;
using System.Text.Json;
using SharedSpaces.Cli.Core.Services;

namespace SharedSpaces.Cli.Commands;

public static class ItemsCommand
{
    public static Command Create()
    {
        var spaceIdArgument = new Argument<string>("space-id") { Description = "The ID of the space to list items from" };
        var jsonOption = new Option<bool>("--json") { Description = "Output as JSON" };

        var command = new Command("items", "List all items in a space");
        command.Add(spaceIdArgument);
        command.Add(jsonOption);

        command.SetAction(async (parseResult, ct) =>
        {
            var spaceId = parseResult.GetValue(spaceIdArgument)!;
            var json = parseResult.GetValue(jsonOption);
            await HandleAsync(spaceId, json, ct);
        });

        return command;
    }

    private static async Task HandleAsync(string spaceId, bool json, CancellationToken ct)
    {
        var configService = new ConfigService();
        var config = await configService.LoadAsync(ct);

        var space = config.Spaces.FirstOrDefault(s =>
            s.SpaceId.Equals(spaceId, StringComparison.OrdinalIgnoreCase));

        if (space is null)
        {
            Console.Error.WriteLine($"Space '{spaceId}' not found in config. Use 'spaces' to list joined spaces.");
            return;
        }

        using var client = new SharedSpacesApiClient();
        var items = await client.ListItemsAsync(space.ServerUrl, space.SpaceId, space.JwtToken, ct);

        if (json)
        {
            var output = items.Select(i => new
            {
                id = i.Id,
                spaceId = i.SpaceId,
                memberId = i.MemberId,
                contentType = i.ContentType,
                content = i.Content,
                fileSize = i.FileSize,
                sharedAt = i.SharedAt,
            });
            Console.WriteLine(JsonSerializer.Serialize(output, new JsonSerializerOptions { WriteIndented = true }));
            return;
        }

        if (items.Count == 0)
        {
            Console.WriteLine("No items in this space.");
            return;
        }

        const int idWidth = -36;
        const int typeWidth = -12;
        const int contentWidth = -30;
        const int sizeWidth = -10;

        Console.WriteLine(
            $"{"ID",idWidth}  {"Type",typeWidth}  {"Content",contentWidth}  {"Size",sizeWidth}  Shared At");
        Console.WriteLine(
            $"{new string('-', -idWidth)}  {new string('-', -typeWidth)}  {new string('-', -contentWidth)}  {new string('-', -sizeWidth)}  {new string('-', 19)}");

        foreach (var item in items)
        {
            var content = item.Content.Length > 30 ? item.Content[..27] + "..." : item.Content;
            Console.WriteLine(
                $"{item.Id.ToString(),idWidth}  {item.ContentType,typeWidth}  {content,contentWidth}  {item.FileSize.ToString(),sizeWidth}  {item.SharedAt:yyyy-MM-dd HH:mm:ss}");
        }
    }
}
