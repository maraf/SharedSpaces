using System.CommandLine;
using System.CommandLine.Parsing;
using SharedSpaces.Cli.Commands;

var rootCommand = new RootCommand("SharedSpaces CLI — join spaces and sync files");
rootCommand.Add(JoinCommand.Create());
rootCommand.Add(SpacesCommand.Create());
rootCommand.Add(ItemsCommand.Create());
rootCommand.Add(UploadCommand.Create());
rootCommand.Add(SyncCommand.Create());

return await CommandLineParser.Parse(rootCommand, args).InvokeAsync();
