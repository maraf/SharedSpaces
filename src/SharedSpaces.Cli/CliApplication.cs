using System.CommandLine;
using System.CommandLine.Parsing;
using SharedSpaces.Cli.Commands;

namespace SharedSpaces.Cli;

public static class CliApplication
{
    public static RootCommand CreateRootCommand()
    {
        var rootCommand = new RootCommand("SharedSpaces CLI — join spaces and sync files");
        rootCommand.Add(JoinCommand.Create());
        rootCommand.Add(LeaveCommand.Create());
        rootCommand.Add(SpacesCommand.Create());
        rootCommand.Add(ItemsCommand.Create());
        rootCommand.Add(UploadCommand.Create());
        rootCommand.Add(SendCommand.Create());
        rootCommand.Add(SyncCommand.Create());
        return rootCommand;
    }

    public static Task<int> RunAsync(string[] args, CancellationToken ct = default)
        => CommandLineParser.Parse(CreateRootCommand(), args).InvokeAsync(cancellationToken: ct);
}
